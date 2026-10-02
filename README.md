# Agentic AI Portfolio

A static portfolio site showcasing agentic AI applications, each with its own page documenting the complete workflow.

## Projects

| Project | Pattern | Page |
| --- | --- | --- |
| **DeepScout**: Autonomous Research Agent | Orchestrator–workers, parallel sub-agents, critic loop | [`projects/research-agent.html`](projects/research-agent.html) |
| **ResolveAI**: Customer Support Agent | Routing, tool use, policy engine, human-in-the-loop | [`projects/support-agent.html`](projects/support-agent.html) |

**ResolveAI is implemented** as a runnable TypeScript agent (CLI + web UI) in [`agents/resolveai/`](agents/resolveai/).

Each project page includes:

- **Overview**: the problem and what the agent does
- **Architecture**: a clickable flow diagram (click a node to jump to its step)
- **Complete workflow**: every step with inputs, outputs, prompts and code
- **Tools**: each tool the agent can call, with an example schema
- **Sample run**: an interactive replay of an example run that highlights the diagram as it plays
- **Guardrails & evaluation** and **Tech stack**

## Structure

```
index.html                  Home: hero, Projects, Writing, approach, contact
projects/research-agent.html
projects/support-agent.html
articles/guardrails-in-code.html        Technical article
articles/parallel-research-agents.html  Technical article
assets/css/style.css        Shared styles (light/dark theme)
assets/js/main.js           Theme toggle, TOC highlighting, diagram links, trace replay
```

## Running locally

No build step. Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Deploying

Published with GitHub Pages from the `main` branch (Settings → Pages → Deploy from a branch → `main`, root). Every push to `main` updates the site; no build step or workflow is needed.

## Adding a new agentic application

1. Copy one of the files in `projects/` and update the content.
2. Each architecture node uses `data-step="<step id>"` to link to an `<li class="step" id="<step id>">`.
3. The sample run is driven by `window.TRACE` (an array of `{ kind, label, text, step }`), where `kind` is one of `user`, `think`, `tool`, `result`, `guard`, `human`, `final`.
4. Add a card for it in the Projects section of `index.html`.
