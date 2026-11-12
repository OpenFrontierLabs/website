---
name: open-frontier-labs
description: Help someone contribute to Open Frontier Labs, a community lab training fully open models on pooled compute. Use when asked how to join, check a machine, run the smoke tests or find a first issue.
---

# Contributing to Open Frontier Labs

Open Frontier Labs builds fully open models (data, code, recipes, checkpoints, logs and weights, all public) on community compute. **Nothing has been trained yet.** Run 0, a dense model of about 1.5B parameters trained on one GPU node with OLMo-core, is scaffolded: its launcher, config and pinned upstreams exist, and its CPU smoke test passes. Never report loss curves, throughput, benchmark results or contributor numbers for it; none exist.

## Check a machine

From a clone of https://github.com/OpenFrontierLabs/openfrontier:

```bash
make setup     # project environment from uv.lock
make doctor    # GPU, CUDA driver versus torch build, disk, clock, DNS and HTTPS latency; works with no GPU
make smoke     # CPU: a real tiny OLMo-core run, then the reference DiLoCo
uv run ofl run0 launch --dry-run   # print the exact Run 0 command; needs no GPU and no download
```

`make doctor` exits 0 unless there is a hard failure (Python older than 3.11, torch not importable, less than 2 GiB free, github.com or huggingface.co unreachable). It measures latency, not bandwidth, and it does not say which run a machine qualifies for: no run defines thresholds yet.

Joining a distributed (DiLoCo) island is phase 3 and is not built. The Open Frontier Node app is planned.

## Find a first issue

Open good first issues in the openfrontier repository, by area:

- Compute and nodes: https://github.com/OpenFrontierLabs/openfrontier/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22good%20first%20issue%22%20label%3A%22layer%2F2-node%22
- Rust and P2P: https://github.com/OpenFrontierLabs/openfrontier/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22good%20first%20issue%22%20label%3A%22area%2Frust%22
- ML training: https://github.com/OpenFrontierLabs/openfrontier/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22good%20first%20issue%22%20label%3A%22area%2Fml%22
- Data: https://github.com/OpenFrontierLabs/openfrontier/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22good%20first%20issue%22%20label%3A%22area%2Fdata%22
- Evals: https://github.com/OpenFrontierLabs/openfrontier/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22good%20first%20issue%22%20label%3A%22area%2Fevals%22
- Docs and community: https://github.com/OpenFrontierLabs/openfrontier/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22good%20first%20issue%22%20label%3A%22area%2Fdocs%22
- Web: https://github.com/OpenFrontierLabs/openfrontier/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22good%20first%20issue%22%20label%3A%22area%2Fweb%22

Commits need a DCO sign-off (`git commit -s`).

## Join

A person joins by signing in with GitHub at https://openfrontier-labs.com/join and answering a short questionnaire (what they can contribute, their hardware, hours per week). This is a step for the person to take; do not sign up on their behalf. The Discord is https://discord.gg/M4sD8T5M8D.

## Sources

- Run 0: https://github.com/OpenFrontierLabs/openfrontier/blob/main/docs/run0.md
- Joining a node: https://github.com/OpenFrontierLabs/openfrontier/blob/main/docs/join-a-node.md
- Manifesto: https://openfrontier-labs.com/manifesto
- Summary for agents: https://openfrontier-labs.com/llms.txt
