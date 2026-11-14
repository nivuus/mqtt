import { escapeKeyfileValue, readPppoeKeyfile, withPppoeCredentials } from '../pppoeKeyfile';

describe('pppoeKeyfile', () => {
  it('reads the profile UUID and the user name, unescaping GLib escapes', () => {
    const text = '[connection]\nuuid=abc\n\n[pppoe]\nusername=\\sa\\\\b\npassword=x\n';
    expect(readPppoeKeyfile(text)).toEqual({ uuid: 'abc', username: ' a\\b' });
  });

  it('adds missing credential keys at the end of the [pppoe] group, before the next group', () => {
    const text = '[pppoe]\nparent=eth0.835\n\n[ipv4]\nmethod=auto\n';
    expect(withPppoeCredentials(text, 'u', 'p')).toBe(
      '[pppoe]\nparent=eth0.835\nusername=u\npassword=p\n\n[ipv4]\nmethod=auto\n');
  });

  it('keeps keys of other groups that share a name with a credential key', () => {
    const text = '[vpn]\nusername=other\n\n[pppoe]\nusername=old\npassword=old\n';
    expect(withPppoeCredentials(text, 'new', 'pw')).toBe('[vpn]\nusername=other\n\n[pppoe]\nusername=new\npassword=pw\n');
  });

  it('refuses a keyfile without a [pppoe] group', () => {
    expect(() => withPppoeCredentials('[connection]\nid=x\n', 'u', 'p')).toThrow(/no \[pppoe\] group/);
  });

  it('keeps any script verbatim and escapes only what GLib escapes', () => {
    expect(escapeKeyfileValue('пароль密码كلمة')).toBe('пароль密码كلمة');
    expect(escapeKeyfileValue(' a\\b')).toBe('\\sa\\\\b');
  });
});
