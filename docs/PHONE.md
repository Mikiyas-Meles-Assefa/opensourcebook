# Open Sourcebook on your phone

This is the web app opened on a phone on the same Wi-Fi. The iPhone app in the repo is a separate thing: [`IPHONE.md`](IPHONE.md).

**Open on your phone** in Settings (or `npm start -- --phone` in a clone) lets a phone on the same Wi-Fi open Open Sourcebook: Settings and the terminal show a QR code, you scan it with the phone's camera, and it opens there as a feed of what you made, one thing per screen. It is remembered until you turn it off in Settings or with `--no-phone`. By default Open Sourcebook listens on this computer only. It has not been tried on a real phone yet; the pairing and the door are covered by tests.

What makes this safe enough on a home network, and what does not:

- Only one small door (`cli/door.ts`) listens on the network. The engine, the web app and the other programs stay on this computer.
- Each device pairs once. The QR code carries a one-time code that works for ten minutes and is never written in a request or a log (it sits after the `#`). Wrong codes are counted, and a device that sends too many waits ten minutes. A paired device gets its own long random token in a cookie its scripts cannot read; `state/devices.json` keeps only a hash of it. The cookie lasts thirty days from the last time the device opened Open Sourcebook, and a device unused for that long pairs again. Anything without a valid token, except this computer itself, sees only "Scan the code on your computer".
- The door refuses a request whose address is not this computer's (so another web page cannot reach it through a name of its own), refuses writes from other sites, and refuses any path not written the one plain way the web app reads it. Device management (the code, pairing, removing a device, turning the door off) is never served through the door, however a path is spelled: it is in Settings in this computer's browser, and in `opensourcebook device`.
- `opensourcebook device list` lists the paired devices and `opensourcebook device remove <id>` unpairs one at once; `opensourcebook device pair` shows a new code in the terminal; Settings has the same list.
- It is plain HTTP, not encrypted. Someone who can watch your network's traffic could read what Open Sourcebook sends and take a device's cookie. Use it on a network you trust, not on public Wi-Fi.
- A paired phone is tied to the computer's address on the network; if the address changes, pair again. The phone can show Open Sourcebook only while the computer is on and Open Sourcebook is running; it says so, and carries on by itself when the computer is back.
