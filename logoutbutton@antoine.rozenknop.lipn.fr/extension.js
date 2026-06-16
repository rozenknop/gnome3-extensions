/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

/*
 * Copyright © 2026 Antoine Rozenknop
 * Copyright © 2023 Levente Farkas
 * Copyright © 2015 Mike Chaberski
 * Copyright © 2014 Sriram Ramkrishna
 *
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Lesser General Public
 * License as published by the Free Software Foundation; either
 * version 2 of the licence, or (at your option) any later version.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public
 * License along with this library. If not, see <http://www.gnu.org/licenses/>.
 *
 * Author: Mike Chaberski <mike10004@users.noreply.github.com>
 * Author: Levente Farkas <lfarkas@lfarkas.org>
 * Author: Antoine Rozenknop <antoine.rozenknop@lipn.fr>
 */

/*
 * Simple extension to add a logout button to the panel.
 */

import Gio from 'gi://Gio';
import St from 'gi://St';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as GnomeSession from 'resource:///org/gnome/shell/misc/gnomeSession.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

const LOGOUT_MODE_NORMAL = 0;

export default class LogoutButtonExtension extends Extension {
  _indicator = null;
  _baseGIcon = null;
  _hoverGIcon = null;
  _buttonIcon = null;
  _sessionManager = null;

  enable() {
    const dir = Gio.File.new_for_path(this.path);
    this._baseGIcon = new Gio.FileIcon({ file: dir.get_child('icons/logout-base.svg') });
    this._hoverGIcon = new Gio.FileIcon({ file: dir.get_child('icons/logout-hover.svg') });

    this._indicator = new PanelMenu.Button(0.0, 'Déconnexion', true);
    this._buttonIcon = new St.Icon({
      gicon: this._baseGIcon,
      style_class: 'system-status-icon'
    });
    this._indicator.add_child(this._buttonIcon);

    this._indicator.connect('button-press-event', (_actor, event) => {
      if (event.get_button() !== 1)
        return false;
      this._doLogout();
      return true;
    });
    this._indicator.connect('enter-event', () => this._setButtonIcon('hover'));
    this._indicator.connect('leave-event', () => this._setButtonIcon('base'));

    this._sessionManager = new GnomeSession.SessionManager();

    Main.panel.addToStatusArea(this.uuid, this._indicator, 99, 'right');
  }

  disable() {
    this._indicator?.destroy();
    this._indicator = null;
    this._buttonIcon = null;
    this._baseGIcon = null;
    this._hoverGIcon = null;
    this._sessionManager = null;
  }

  _setButtonIcon(mode) {
    if (mode === 'hover')
      this._buttonIcon?.set_gicon(this._hoverGIcon);
    else
      this._buttonIcon?.set_gicon(this._baseGIcon);
  }

  _doLogout() {
    this._sessionManager?.LogoutRemote(LOGOUT_MODE_NORMAL);
  }
}
