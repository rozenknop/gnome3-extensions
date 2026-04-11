# Codebase Review — gnome3-extensions

**Date:** 2026-04-11
**Scope:** Full security and code quality audit
**Prior reviews:** None

## Executive Summary

| Severity | Count |
|----------|-------|
| Critical | 2     |
| High     | 3     |
| Medium   | 4     |
| Low      | 2     |
| **Total**| **11**|

Two GNOME Shell panel-button extensions (~160 lines JS total). The codebase has a narrow attack surface — no network I/O, no eval, no subprocess spawning — but has significant lifecycle management bugs that can crash `gnome-shell` (the desktop compositor) during extension enable/disable cycles.

All findings except F-010 (Makefile, no fix needed) have been resolved.

---

## Findings

| ID | Severity | File | Description | Status |
|----|----------|------|-------------|--------|
| F-001 | Critical | both `extension.js` | Signal handlers not disconnected in `disable()` | **Fixed** |
| F-002 | Critical | `logoutbutton/extension.js` | Module-scoped mutable `var` globals survive disable/enable cycles | **Fixed** |
| F-003 | High | both `extension.js` | `.destroy()` not called on Clutter actors in `disable()` | **Fixed** |
| F-004 | High | `logoutbutton/extension.js` | `SessionManager` D-Bus proxy recreated on every click; no error handling | **Fixed** |
| F-005 | High | `logoutbutton/extension.js` | Duplicate `Gio.icon_new_for_string()` — orphaned GIcon object | **Fixed** |
| F-006 | Medium | `logoutbutton/extension.js` | Path construction via string concatenation instead of `Gio.File` | **Fixed** |
| F-007 | Medium | both `extension.js` | Private API `Main.panel._rightBox` used instead of `addToStatusArea()` | **Fixed** |
| F-008 | Medium | `lockscreen/extension.js` | No null guard on `Main.screenShield` before `.lock()` | **Fixed** |
| F-009 | Medium | `logoutbutton/extension.js` | `var` used instead of `const`/`let` | **Fixed** |
| F-010 | Low | `Makefile` | `unzip -o` overwrites without integrity verification | N/A |
| F-011 | Low | `lockscreen/extension.js` | Dead `y_align` property; `Clutter` import only needed for it | **Fixed** |

---

## Detailed Analysis

### F-001 — Signal handlers not disconnected in `disable()` [Critical]

**Files:** `lockscreen@lfarkas.org/extension.js:51`, `logoutbutton@lfarkas.org/extension.js:64-69`

Both extensions call `.connect()` on button widgets but discard the returned signal IDs. `disable()` never calls `.disconnect()`. When GNOME Shell calls `disable()` (on extension toggle, screen lock, or shell restart), the signal connections remain live on the underlying GObject. A queued event (e.g., `leave-event` after panel removal) fires the handler on a destroyed/orphaned widget, causing a TypeError that crashes `gnome-shell`.

**Current code (logoutbutton):**
```javascript
this.logoutButton.connect('button-press-event', _DoLogout);
this.logoutButton.connect('enter-event', function () {
  _SetButtonIcon('hover');
});
this.logoutButton.connect('leave-event', function () {
  _SetButtonIcon('base');
});
```

**Recommended fix:**
```javascript
enable() {
  // ...
  this._signalIds = [
    this.logoutButton.connect('button-press-event', () => this._doLogout()),
    this.logoutButton.connect('enter-event', () => this._setButtonIcon('hover')),
    this.logoutButton.connect('leave-event', () => this._setButtonIcon('base')),
  ];
}

disable() {
  for (const id of this._signalIds)
    this.logoutButton.disconnect(id);
  this._signalIds = null;
  // ...
}
```

---

### F-002 — Module-scoped mutable `var` globals [Critical]

**File:** `logoutbutton@lfarkas.org/extension.js:38-40`

```javascript
var baseGIcon;
var hoverGIcon;
var buttonIcon;
```

These module-level variables persist across `enable()`/`disable()` cycles for the entire shell session. GJS never unloads extension modules between cycles. After `disable()`, these retain references to destroyed objects. On the next `enable()`, old references are silently overwritten. If `_SetButtonIcon` fires during a disable/enable race, it dereferences a stale `buttonIcon` and crashes the shell.

**Recommended fix:** Promote to instance properties:
```javascript
export default class LogoutButtonExtension extends Extension {
  logoutButton = null;
  _baseGIcon = null;
  _hoverGIcon = null;
  _buttonIcon = null;

  enable() {
    const dir = this.path;
    this._baseGIcon = Gio.icon_new_for_string(`${dir}/icons/logout-base.svg`);
    this._hoverGIcon = Gio.icon_new_for_string(`${dir}/icons/logout-hover.svg`);
    this._buttonIcon = new St.Icon({
      gicon: this._baseGIcon,
      style_class: 'system-status-icon',
    });
    // ...
  }

  disable() {
    // ... disconnect signals first
    Main.panel._rightBox.remove_child(this.logoutButton);
    this.logoutButton.destroy();
    this.logoutButton = null;
    this._buttonIcon = null;
    this._baseGIcon = null;
    this._hoverGIcon = null;
  }
}
```

---

### F-003 — `.destroy()` not called on Clutter actors in `disable()` [High]

**Files:** `logoutbutton@lfarkas.org/extension.js:76`, `lockscreen@lfarkas.org/extension.js:57`

Both `disable()` methods call `remove_child()` and null the reference, but never call `.destroy()`. `St.Bin` and `St.Icon` are `Clutter.Actor` subclasses with native GObject resources that are not freed by simply dropping the JS reference. Repeated enable/disable cycles accumulate unreleased native objects.

**Recommended fix:** Add `.destroy()` before nulling:
```javascript
disable() {
  Main.panel._rightBox.remove_child(this.lockScreenButton);
  this.lockScreenButton.destroy();
  this.lockScreenButton = null;
}
```

---

### F-004 — `SessionManager` recreated per click with no error handling [High]

**File:** `logoutbutton@lfarkas.org/extension.js:89-91`

```javascript
function _DoLogout() {
  var sessionManager = new GnomeSession.SessionManager();
  sessionManager.LogoutRemote(LOGOUT_MODE_NORMAL);
}
```

`GnomeSession.SessionManager` is a D-Bus proxy. Constructing it synchronously on each click is expensive, and if the D-Bus session bus is unavailable, this throws an unhandled exception inside a signal handler — which in GJS propagates to the shell's main loop and can crash it.

**Recommended fix:** Create once in `enable()`, reuse, and add error handling:
```javascript
enable() {
  this._sessionManager = new GnomeSession.SessionManager();
  // ...
}

_doLogout() {
  this._sessionManager?.LogoutRemote(LOGOUT_MODE_NORMAL);
}

disable() {
  this._sessionManager = null;
  // ...
}
```

---

### F-005 — Duplicate `Gio.icon_new_for_string()` allocation [High]

**File:** `logoutbutton@lfarkas.org/extension.js:56,59`

```javascript
baseGIcon = Gio.icon_new_for_string(dir + "/icons/logout-base.svg");  // line 56
buttonIcon = new St.Icon({
  'gicon': Gio.icon_new_for_string(dir + "/icons/logout-base.svg"),   // line 59 — duplicate!
  'style_class': 'system-status-icon'
});
```

Line 59 allocates a second GIcon for the same file instead of reusing `baseGIcon`. The duplicate is immediately orphaned when `_SetButtonIcon('base')` replaces it.

**Recommended fix:** `gicon: baseGIcon` (or `this._baseGIcon` after F-002 refactor).

---

### F-006 — Path construction via string concatenation [Medium]

**File:** `logoutbutton@lfarkas.org/extension.js:56-57`

`this.path` is concatenated directly into file paths: `dir + "/icons/logout-base.svg"`. While `this.path` is GNOME Shell–controlled, `Gio.icon_new_for_string` also accepts URI strings. Using `Gio.File`-based path joining is more defensive.

**Recommended fix:**
```javascript
const dir = Gio.File.new_for_path(this.path);
this._baseGIcon = new Gio.FileIcon({ file: dir.get_child('icons/logout-base.svg') });
this._hoverGIcon = new Gio.FileIcon({ file: dir.get_child('icons/logout-hover.svg') });
```

---

### F-007 — Private API `_rightBox` usage [Medium]

**Files:** `logoutbutton@lfarkas.org/extension.js:72`, `lockscreen@lfarkas.org/extension.js:53`

Both extensions use `Main.panel._rightBox` (underscore-prefixed private API) instead of the public `Main.panel.addToStatusArea()`. Private APIs have no stability guarantee across GNOME Shell versions.

**Recommended fix:** Use `PanelMenu.Button` with `addToStatusArea()`:
```javascript
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

enable() {
  this._indicator = new PanelMenu.Button(0.0, 'Lock Screen', true);
  const icon = new St.Icon({
    icon_name: 'changes-prevent-symbolic',
    style_class: 'system-status-icon',
  });
  this._indicator.add_child(icon);
  this._indicator.connect('button-press-event', () => this._lockScreen());
  Main.panel.addToStatusArea('lockscreen-button', this._indicator, 0, 'right');
}

disable() {
  this._indicator?.destroy();
  this._indicator = null;
}
```

---

### F-008 — No null guard on `Main.screenShield` [Medium]

**File:** `lockscreen@lfarkas.org/extension.js:62-67`

```javascript
function _LockScreenActivate() {
    Main.overview.hide();
    Main.screenShield.lock(true)
}
```

`Main.screenShield` can be `null` during early shell startup or in certain session types. Calling `.lock(true)` on `null` crashes the shell.

**Recommended fix:**
```javascript
function _LockScreenActivate() {
  Main.overview?.hide();
  Main.screenShield?.lock(true);
}
```

---

### F-009 — `var` instead of `const`/`let` [Medium]

**File:** `logoutbutton@lfarkas.org/extension.js:38-40,54`

`var` is used at module scope and inside `enable()`. Modern GJS convention uses `const` for bindings that are never reassigned, `let` for those that are. This is resolved automatically by the F-002 refactor.

---

### F-010 — Makefile `unzip -o` without integrity check [Low]

**File:** `Makefile:14`

The install target silently overwrites the extension directory. This is expected behavior for a development install target. No fix required for normal use.

---

### F-011 — Dead `y_align` property and unnecessary `Clutter` import [Low]

**File:** `lockscreen@lfarkas.org/extension.js:43,28`

`y_align: Clutter.ActorAlign.CENTER` on an `St.Bin` inside a `BoxLayout` has no effect — `BoxLayout` controls alignment via expand/fill, not `y_align` on children. The `Clutter` import exists only for this. Can be removed.

---

## Fix Priority

Fixing F-001 + F-002 + F-003 together as a single refactor is the most impactful change. It resolves both Critical findings, one High, and makes F-005/F-006/F-009 trivial to fix as side effects.

**Recommended fix order:**
1. F-001 + F-002 + F-003 + F-005 + F-009 (combined refactor — both extensions)
2. F-004 (SessionManager lifecycle)
3. F-008 (null guard)
4. F-006 (Gio.File path construction)
5. F-007 (addToStatusArea — optional, larger change)
6. F-010, F-011 (low priority)
