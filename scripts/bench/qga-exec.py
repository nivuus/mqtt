#!/usr/bin/env python3
"""Run a shell command in the bench VM through the QEMU guest agent socket.

Works when the VM's firewall blocks SSH. Prints stdout/stderr, exits with the
command's exit code. Usage: qga-exec.py <qga.sock> '<shell command>'
"""
import base64
import json
import socket
import sys
import time


def call(sock, reader, cmd, args=None):
    msg = {"execute": cmd}
    if args is not None:
        msg["arguments"] = args
    sock.sendall(json.dumps(msg).encode() + b"\n")
    while True:
        reply = json.loads(reader.readline())
        if "return" in reply or "error" in reply:
            if "error" in reply:
                raise RuntimeError(reply["error"])
            return reply["return"]


def main(path, command):
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.connect(path)
    reader = sock.makefile("r")
    # guest-sync flushes any stale reply left on the channel.
    call(sock, reader, "guest-sync", {"id": 4242})
    pid = call(sock, reader, "guest-exec", {
        "path": "/bin/bash", "arg": ["-c", command], "capture-output": True,
    })["pid"]
    while True:
        st = call(sock, reader, "guest-exec-status", {"pid": pid})
        if st.get("exited"):
            break
        time.sleep(0.3)
    for key, stream in (("out-data", sys.stdout), ("err-data", sys.stderr)):
        if key in st:
            stream.write(base64.b64decode(st[key]).decode(errors="replace"))
    return st.get("exitcode", 1)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2]))
