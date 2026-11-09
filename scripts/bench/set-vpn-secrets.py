#!/usr/bin/env python3
"""Store the OpenVPN username/password in an NM profile without exposing them.

Reads the credentials file itself (line 1 user, line 2 password), so nothing
secret appears in argv, the environment or the output. Uses libnm (the
NetworkManager client library) to update the profile, with password-flags=0
so NM keeps the secret in the system keyfile and can autoconnect unattended.

Usage: set-vpn-secrets.py <connection-id> <credentials-file>
"""
import sys

import gi

gi.require_version("NM", "1.0")
from gi.repository import GLib, NM  # noqa: E402


def main(conn_id, cred_path):
    with open(cred_path, encoding="utf-8") as fh:
        lines = fh.read().splitlines()
    if len(lines) < 2 or not lines[0] or not lines[1]:
        raise SystemExit("credentials file must hold the user then the password")
    user, password = lines[0].strip(), lines[1]

    client = NM.Client.new(None)
    remote = client.get_connection_by_id(conn_id)
    if remote is None:
        raise SystemExit(f"no connection named {conn_id}")
    # get_connection_by_id gives a copy without secrets; edit a full copy.
    conn = NM.SimpleConnection.new_clone(remote)
    vpn = conn.get_setting_vpn()
    vpn.add_data_item("username", user)
    vpn.add_data_item("password-flags", "0")
    vpn.add_secret("password", password)

    loop = GLib.MainLoop()
    result = {}

    def done(obj, res):
        try:
            obj.commit_changes_finish(res)
            result["ok"] = True
        except GLib.Error as err:
            result["err"] = err.message
        loop.quit()

    remote.replace_settings_from_connection(conn)
    remote.commit_changes_async(True, None, done)
    loop.run()
    if "err" in result:
        raise SystemExit(f"commit failed: {result['err']}")
    print(f"{conn_id}: username and password stored (password-flags=0)")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
