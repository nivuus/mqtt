import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import { writeVpnCredentials } from "../nmSecrets";

const KEYFILE = [
  "[connection]",
  "id=nivuus-guest-vpn",
  "type=vpn",
  "",
  "[vpn]",
  "connection-type=password",
  "dev=nvguest0",
  "password-flags=1",
  "remote=vpn.example.com:1194",
  "service-type=org.freedesktop.NetworkManager.openvpn",
  "",
  "[ipv4]",
  "method=auto",
  "",
].join("\n");

const section = (text: string, name: string): string[] => {
  const lines = text.split("\n");
  const start = lines.indexOf(`[${name}]`);
  if (start < 0) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex(l => l.startsWith("["));
  return (end < 0 ? rest : rest.slice(0, end)).filter(l => l !== "");
};

describe("writeVpnCredentials", () => {
  let dir: string;
  let file: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "vpn-keyfile-"));
    file = path.join(dir, "nivuus-guest-vpn.nmconnection");
    await fs.writeFile(file, KEYFILE, { mode: 0o600 });
  });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it("sets [vpn-secrets] password and password-flags=0, keeps other sections, file stays 0600", async () => {
    await writeVpnCredentials(file, { username: "guest@example.com", password: "s3cret" });
    const text = await fs.readFile(file, "utf8");
    expect(section(text, "vpn-secrets")).toEqual(["password=s3cret"]);
    const vpn = section(text, "vpn");
    expect(vpn).toContain("password-flags=0");
    expect(vpn).not.toContain("password-flags=1");
    expect(vpn).toContain("username=guest@example.com");
    expect(vpn).toContain("dev=nvguest0");
    expect(section(text, "connection")).toEqual(["id=nivuus-guest-vpn", "type=vpn"]);
    expect(section(text, "ipv4")).toEqual(["method=auto"]);
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    expect(await fs.readdir(dir)).toEqual(["nivuus-guest-vpn.nmconnection"]);
  });

  it("replaces an existing password instead of adding a second one", async () => {
    await writeVpnCredentials(file, { username: "a", password: "old" });
    await writeVpnCredentials(file, { username: "b", password: "new" });
    const text = await fs.readFile(file, "utf8");
    expect(section(text, "vpn-secrets")).toEqual(["password=new"]);
    expect(section(text, "vpn").filter(l => l.startsWith("username="))).toEqual(["username=b"]);
  });

  it("escapes values the way GKeyFile reads them, keeping any script intact", async () => {
    await writeVpnCredentials(file, { username: "ユーザー", password: " a\\b cdéمש " });
    const text = await fs.readFile(file, "utf8");
    expect(section(text, "vpn-secrets")).toEqual(["password=\\sa\\\\b cdéمש "]);
    expect(section(text, "vpn")).toContain("username=ユーザー");
  });

  it.each([
    ["password", { username: "u", password: "a\u0000b" }],
    ["password", { username: "u", password: "line\nbreak" }],
    ["username", { username: "u\tser", password: "p" }],
    ["username", { username: "u\u001bser", password: "p" }],
  ])("rejects control characters in the %s and leaves the file untouched", async (field, creds) => {
    await expect(writeVpnCredentials(file, creds)).rejects.toThrow(new RegExp(`${field}.*control character`));
    expect(await fs.readFile(file, "utf8")).toBe(KEYFILE);
  });

  it("refuses a file that is not a VPN keyfile", async () => {
    await fs.writeFile(file, "[connection]\nid=x\n", { mode: 0o600 });
    await expect(writeVpnCredentials(file, { username: "a", password: "b" })).rejects.toThrow(/\[vpn\]/);
  });
});
