/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

/*
 * Copyright © 2023 Levente Farkas
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
 * Author: Sriram Ramkrishna <sri@ramkrishna.me>
 * Author: Levente Farkas <lfarkas@lfarkas.org>
 */

/*
 * Simple extension to lock the screen from an icon on the panel.
 */

import St from 'gi://St';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

export default class LockScreenButtonExtension extends Extension {
	_indicator = null;

	enable() {
		this._indicator = new PanelMenu.Button(0.0, 'Lock Screen', true);
		const icon = new St.Icon({
			icon_name: 'changes-prevent-symbolic',
			style_class: 'system-status-icon'
		});
		this._indicator.add_child(icon);
		this._indicator.connect('button-press-event', (_actor, event) => {
			if (event.get_button() !== 1)
				return false;
			Main.overview?.hide();
			Main.screenShield?.lock(true);
			return true;
		});

		Main.panel.addToStatusArea(this.uuid, this._indicator, 0, 'right');
	}

	disable() {
		this._indicator?.destroy();
		this._indicator = null;
	}
}
