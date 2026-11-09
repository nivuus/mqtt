import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import { readDesiredEnabled, writeDesiredEnabled } from "../desiredState";

describe("desired state", () => {
  let dir: string;
  beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), "vpn-state-")); });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it("defaults to off when the file is missing", async () => {
    await expect(readDesiredEnabled(path.join(dir, "missing.json"))).resolves.toBe(false);
  });

  it("round-trips on and off", async () => {
    const file = path.join(dir, "guest-vpn.json");
    await writeDesiredEnabled(file, true);
    await expect(readDesiredEnabled(file)).resolves.toBe(true);
    await writeDesiredEnabled(file, false);
    await expect(readDesiredEnabled(file)).resolves.toBe(false);
  });

  it("creates the parent directory and writes the file 0600 without leftovers", async () => {
    const file = path.join(dir, "nested", "guest-vpn.json");
    await writeDesiredEnabled(file, true);
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    expect(await fs.readdir(path.dirname(file))).toEqual(["guest-vpn.json"]);
  });

  it("throws on a corrupt file instead of guessing", async () => {
    const file = path.join(dir, "guest-vpn.json");
    await fs.writeFile(file, "{not json");
    await expect(readDesiredEnabled(file)).rejects.toThrow();
    await fs.writeFile(file, JSON.stringify({ enabled: "yes" }));
    await expect(readDesiredEnabled(file)).rejects.toThrow(/enabled/);
  });
});
