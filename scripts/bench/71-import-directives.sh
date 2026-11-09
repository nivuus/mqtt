#!/usr/bin/env bash
# Runs INSIDE the bench VM. Task 1 step 7: what `nmcli connection import` does
# with path-taking directives (ca, tls-auth, crl-verify, auth-user-pass <file>).
# Builds a variant of the provider profile where every inline block is a file.
set -uo pipefail
export LC_ALL=C

echo "== import of path-taking directives"
D=/root/vpn/variants
mkdir -p "$D"; chmod 700 "$D"
src=/root/vpn/variants/source-lf.ovpn
# The provider file has CRLF line endings and no final newline.
tr -d "\\r" < /root/vpn/alkmaar.ovpn > "$src"; echo >> "$src"
sed -n '/^<tls-auth>/,/^<\/tls-auth>/p' "$src" | sed '1d;$d' > "$D/ta.key"
sed -n '/^<ca>/,/^<\/ca>/p' "$src" | sed '1d;$d' > "$D/ca.crt"
: > "$D/crl.pem"
# Variant: every inline block replaced by a path, plus crl-verify and a
# credentials file on auth-user-pass.
sed -e '/^<ca>/,/^<\/ca>/d' -e '/^<tls-auth>/,/^<\/tls-auth>/d' -e '/^key-direction/d' \
    -e "s#^auth-user-pass\$#auth-user-pass $D/auth.txt#" "$src" > "$D/paths.ovpn"
printf '\nca %s\ntls-auth %s 1\ncrl-verify %s\n' "$D/ca.crt" "$D/ta.key" "$D/crl.pem" >> "$D/paths.ovpn"
cp /root/vpn/auth.txt "$D/auth.txt"
chmod 600 "$D"/*
out="$(nmcli connection import type openvpn file "$D/paths.ovpn" 2>&1)"
echo "  import: $out" | sed 's/[0-9a-f-]\{36\}/<uuid>/'
nmcli -g vpn.data connection show paths | tr ',' '\n' | sed 's/^ *//' | grep -v '^username' \
  | grep -E '^ *(ca|ta|ta-dir|crl-verify-file|crl-verify-dir|connection-type|password-flags|cert|key) ' | sed 's/^/    /'
echo "    username stored from the auth-user-pass file: $(nmcli -g vpn.data connection show paths | grep -c 'username')"
echo "    password stored: $(nmcli --show-secrets -g vpn.secrets connection show paths | grep -c 'password')"
ls -la ~/.local/share/networkmanagement/certificates/nm-openvpn/ | sed 's/^/    certs dir: /'
nmcli connection delete paths >/dev/null
