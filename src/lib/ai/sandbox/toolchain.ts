/**
 * The render toolchain inside the sandbox image, in one place.
 *
 * The render sandbox runs with its network blocked (./daytona.ts
 * sandboxNetworkPolicy), so a render can only use what the image already
 * contains. The image is defined by infra/sandbox/Dockerfile and built by
 * infra/sandbox/build-snapshot.mjs; this module says what that image
 * provides, and is what the render skill tells the agent to use
 * (lib/ai/skills/catalog.ts) and what the tool refuses before spending
 * anything (commands that need the network or a package install).
 * src/lib/ai/sandbox/toolchain.test.ts checks the Dockerfile installs every
 * tool named here and that the skill names nothing else.
 *
 * Pure: no imports, safe in tests.
 */

/**
 * Version of the image's toolchain. The Dockerfile writes it to
 * RENDER_IMAGE_MARKER; the runner refuses (cleanly, with one log line) an
 * image that reports an older version or none, i.e. an image built before
 * the offline toolchain existed. Bump both together when the image changes
 * in a way the skill depends on.
 */
export const RENDER_IMAGE_VERSION = 2;
/** File in the image holding `studyos-render-image <version>`. */
export const RENDER_IMAGE_MARKER = "/etc/studyos-render-image";

/**
 * The first command of every run: make the output folder and report the
 * image's toolchain version (an image without the marker prints nothing).
 */
export const PREPARE_COMMAND = `mkdir -p out && (cat ${RENDER_IMAGE_MARKER} 2>/dev/null || true)`;

/** The toolchain version an image reported in PREPARE_COMMAND's output, or null. */
export function reportedImageVersion(output: string | undefined): number | null {
  const match = /studyos-render-image\s+(\d+)/.exec(output ?? "");
  return match ? Number(match[1]) : null;
}

/** The commands the image provides that a render may run (all offline). */
export const RENDER_COMMANDS = [
  "pdflatex",
  "xelatex",
  "latex",
  "dvisvgm",
  "pdftoppm",
  "pdftocairo",
  "python3",
  "dot",
  "neato",
  "rsvg-convert",
] as const;

/** Python modules the image provides (system packages, no pip at run time). */
export const RENDER_PYTHON_MODULES = ["matplotlib", "numpy", "scipy", "sympy"] as const;

/** LaTeX packages the image is checked to compile at build time (see the Dockerfile smoke test). */
export const RENDER_LATEX_PACKAGES = [
  "standalone",
  "amsmath",
  "amssymb",
  "mathtools",
  "siunitx",
  "mhchem",
  "tikz",
  "pgfplots",
  "circuitikz",
  "xeCJK",
  "fontspec",
] as const;

/**
 * Commands that need the network or install software, which cannot work in
 * the network-blocked sandbox: a run that uses one is refused before any
 * credits are reserved or a sandbox is started, with a message saying what
 * to use instead. Matched as whole words anywhere in a command.
 */
const NETWORK_COMMANDS =
  /(^|[\s;&|(`$])(apt|apt-get|dpkg|pip|pip3|npm|npx|yarn|pnpm|conda|tlmgr|tectonic|mmdc|curl|wget|git|ssh|scp)(\s|$)/;
const PYTHON_PIP = /python3?\s+-m\s+pip\b/;

/** The first command of `commands` that needs the network or installs software, if any. */
export function networkCommand(commands: readonly string[]): string | null {
  return commands.find((c) => NETWORK_COMMANDS.test(c) || PYTHON_PIP.test(c)) ?? null;
}

/**
 * The render skill's instructions (lib/ai/skills/catalog.ts): only the
 * offline tools above, with working command lines.
 */
export const RENDER_SKILL_INSTRUCTIONS = [
  "Use when the request needs a rendered image (an equation, a diagram, a plot).",
  "The sandbox has NO network and nothing can be installed: never use `setup` for installs and never run apt, pip, npm, tlmgr, tectonic or curl.",
  `Available offline: ${RENDER_COMMANDS.join(", ")}; Python ${RENDER_PYTHON_MODULES.join(", ")}; TeX Live with ${RENDER_LATEX_PACKAGES.join(", ")} and the Latin Modern, DejaVu and Noto fonts (CJK and Arabic included).`,
  "LaTeX: write eq.tex with \\documentclass[border=6pt,preview]{standalone} and the packages you need, then run `pdflatex -interaction=nonstopmode -halt-on-error -no-shell-escape eq.tex` (use xelatex for Chinese, Japanese or Arabic text) and `pdftoppm -png -r 300 -singlefile eq.pdf out/eq`; list out/eq.png in outputs.",
  "Plots: write plot.py using matplotlib (backend Agg) and numpy, save with plt.savefig('out/plot.png', dpi=200, bbox_inches='tight'), run `python3 plot.py`.",
  "Diagrams: write graph.dot and run `dot -Tpng -Gdpi=200 graph.dot -o out/graph.png`.",
  "Write the source with run_in_sandbox (inputs + run commands that write files under out/, list them in outputs). For each returned artifact, read the target page and call apply_ops with set_page_blocks that appends a media block { type:'media', assetId:<handle.assetId>, mediaKind:'image', mime:<handle.mime>, caption:<short> }. Keep ids exact; never inline the image yourself.",
  "If a render fails, read the log once and fix a mistake in your own source; if it fails again or says rendering is unavailable, do not retry: tell the student in one sentence that the visual couldn't be rendered (nothing was charged for it) and give the content another way, an equation as $…$ math in a text block, a plot as a short table or description.",
].join(" ");
