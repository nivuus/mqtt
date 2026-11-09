#!/usr/bin/env python3
"""Explain an nftables "Could not process rule: No such file or directory".

Replays a firewalld JSON transaction (the blob logged on failure) against a
ruleset snapshot taken just before it (`nft -j list ruleset`), and reports the
first command that nft would reject: an "add rule ... index N" whose chain has
at most N rules at that point of the batch, or a jump/goto/rule into a chain
that does not exist.

Usage: nft-index-check.py <ruleset.json> <blob.json>
"""
import json
import sys


def load_chains(ruleset_path):
    chains = {}
    with open(ruleset_path, encoding="utf-8") as fh:
        for item in json.load(fh)["nftables"]:
            if "chain" in item:
                c = item["chain"]
                chains.setdefault((c["family"], c["table"], c["name"]), 0)
            elif "rule" in item:
                r = item["rule"]
                key = (r["family"], r["table"], r["chain"])
                chains[key] = chains.get(key, 0) + 1
    return chains


def targets(expr):
    out = []
    for e in expr:
        for verb in ("jump", "goto"):
            if isinstance(e, dict) and verb in e:
                out.append(e[verb]["target"])
    return out


def main(ruleset_path, blob_path):
    chains = load_chains(ruleset_path)
    with open(blob_path, encoding="utf-8") as fh:
        blob = json.load(fh)["nftables"]
    problems = 0
    for pos, cmd in enumerate(blob):
        verb = next(iter(cmd))
        body = cmd[verb]
        if verb == "metainfo":
            continue
        if "chain" in body and verb in ("add", "create"):
            c = body["chain"]
            chains.setdefault((c["family"], c["table"], c["name"]), 0)
            continue
        if "rule" not in body or verb not in ("add", "insert"):
            continue
        r = body["rule"]
        key = (r["family"], r["table"], r["chain"])
        if key not in chains:
            print(f"#{pos}: rule into missing chain {r['chain']}")
            problems += 1
            continue
        for t in targets(r["expr"]):
            if (r["family"], r["table"], t) not in chains:
                print(f"#{pos}: jump to missing chain {t} (from {r['chain']})")
                problems += 1
        idx = r.get("index")
        if idx is not None and idx >= chains[key]:
            print(f"#{pos}: {r['chain']} index {idx} but chain has {chains[key]} rules")
            problems += 1
        chains[key] += 1
    print(f"{problems} problem(s) found")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2]))
