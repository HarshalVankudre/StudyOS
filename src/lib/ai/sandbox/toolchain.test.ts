import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  networkCommand,
  PREPARE_COMMAND,
  RENDER_COMMANDS,
  RENDER_IMAGE_MARKER,
  RENDER_IMAGE_VERSION,
  RENDER_LATEX_PACKAGES,
  RENDER_PYTHON_MODULES,
  RENDER_SKILL_INSTRUCTIONS,
  reportedImageVersion,
} from "./toolchain";

const dockerfile = readFileSync(path.join(process.cwd(), "infra/sandbox/Dockerfile"), "utf8");
/** The Dockerfile's instructions, comments dropped. */
const recipe = dockerfile
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("#"))
  .join("\n");

/** Which Ubuntu package provides each command the skill may use. */
const PACKAGE_OF: Record<(typeof RENDER_COMMANDS)[number], string> = {
  pdflatex: "texlive-latex-base",
  xelatex: "texlive-xetex",
  latex: "texlive-latex-base",
  dvisvgm: "dvisvgm",
  pdftoppm: "poppler-utils",
  pdftocairo: "poppler-utils",
  python3: "python3",
  dot: "graphviz",
  neato: "graphviz",
  "rsvg-convert": "librsvg2-bin",
};

describe("the render image (infra/sandbox/Dockerfile)", () => {
  it("installs every command the render skill may use", () => {
    for (const command of RENDER_COMMANDS) expect(recipe, command).toMatch(new RegExp(`\\b${PACKAGE_OF[command]}\\b`));
  });

  it("installs the Python modules from the distribution, not pip", () => {
    for (const name of RENDER_PYTHON_MODULES) expect(recipe).toContain(`python3-${name}`);
    expect(recipe).not.toMatch(/\bpip3? install\b/);
  });

  it("installs TeX Live with the languages, science and drawing packages, and the fonts", () => {
    for (const pkg of ["texlive-latex-extra", "texlive-science", "texlive-pictures", "texlive-lang-cjk", "texlive-lang-arabic", "fonts-noto-cjk", "fonts-noto-core", "lmodern"]) {
      expect(recipe).toContain(pkg);
    }
  });

  it("uses no toolchain that downloads on first use", () => {
    expect(recipe).not.toMatch(/\btectonic\b|mermaid|puppeteer|\bnpm\b/);
  });

  it("smoke-tests at build time every LaTeX package the skill names, with the skill's commands", () => {
    for (const pkg of RENDER_LATEX_PACKAGES) expect(recipe, pkg).toContain(pkg);
    expect(recipe).toContain("pdflatex -interaction=nonstopmode -halt-on-error -no-shell-escape eq.tex");
    expect(recipe).toContain("pdftoppm -png -r 300 -singlefile eq.pdf out/eq");
    expect(recipe).toContain("dot -Tpng -Gdpi=200 graph.dot -o out/graph.png");
    expect(recipe).toContain('plt.savefig("out/plot.png", dpi=200, bbox_inches="tight")');
  });

  it("writes the toolchain version the runner checks, as its last step", () => {
    expect(recipe).toContain(`printf 'studyos-render-image ${RENDER_IMAGE_VERSION}\\n' > ${RENDER_IMAGE_MARKER}`);
    expect(recipe.lastIndexOf(RENDER_IMAGE_MARKER)).toBeGreaterThan(recipe.lastIndexOf("rm -rf /tmp/smoke"));
  });
});

describe("the render skill", () => {
  it("names only the offline tools the image provides", () => {
    const commands = [...RENDER_SKILL_INSTRUCTIONS.matchAll(/`([a-z0-9-]+)\s[^`]*`/g)].map((m) => m[1]);
    expect(commands.length).toBeGreaterThan(0);
    for (const command of commands) expect(RENDER_COMMANDS as readonly string[]).toContain(command);
  });

  it("tells the agent the sandbox has no network, and never to install", () => {
    expect(RENDER_SKILL_INSTRUCTIONS).toMatch(/NO network/);
    expect(RENDER_SKILL_INSTRUCTIONS).toMatch(/never use `setup` for installs/);
  });

  it("tells the agent what to do when a render fails: nothing charged, give it another way", () => {
    expect(RENDER_SKILL_INSTRUCTIONS).toMatch(/nothing was charged/);
    expect(RENDER_SKILL_INSTRUCTIONS).toMatch(/\$…\$ math/);
  });
});

describe("networkCommand", () => {
  it("finds installs and downloads anywhere in a command line", () => {
    expect(networkCommand(["cd x && pip install y"])).toBe("cd x && pip install y");
    expect(networkCommand(["python3 -m pip install numpy"])).not.toBeNull();
    expect(networkCommand(["(wget http://x)"])).not.toBeNull();
  });

  it("lets the offline toolchain through", () => {
    expect(networkCommand(["pdflatex -no-shell-escape a.tex", "python3 plot.py", "dot -Tpng g.dot -o out/g.png"])).toBeNull();
  });
});

describe("the image version check", () => {
  it("reads the version the prepare command prints, or none", () => {
    expect(PREPARE_COMMAND).toContain("mkdir -p out");
    expect(PREPARE_COMMAND).toContain(RENDER_IMAGE_MARKER);
    expect(reportedImageVersion(`studyos-render-image ${RENDER_IMAGE_VERSION}\n`)).toBe(RENDER_IMAGE_VERSION);
    expect(reportedImageVersion("")).toBeNull();
    expect(reportedImageVersion(undefined)).toBeNull();
  });
});
