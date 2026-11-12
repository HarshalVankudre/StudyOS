# StudyOS render sandbox image (Daytona snapshot "studyos-render").
#
# The sandbox runs with its network BLOCKED (src/lib/ai/sandbox/daytona.ts),
# so everything a render needs is installed here, at build time, from the
# distribution's packages: no toolchain that downloads on first use (no
# tectonic, no mermaid-cli/puppeteer), no pip or npm at run time.
# src/lib/ai/sandbox/toolchain.ts lists what this image provides and is what
# the agent's render skill uses; src/lib/ai/sandbox/toolchain.test.ts checks
# that this file installs all of it.
#
# Build and register it with infra/sandbox/build-snapshot.mjs (see README.md).
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

# TeX Live (pdflatex, xelatex, latex, dvisvgm) with the packages students'
# math, science and diagrams need, in the ten UI languages; poppler for
# PDF -> PNG; Graphviz; librsvg for SVG -> PNG; Python plotting from the
# distribution (no pip); fonts for Latin, CJK and Arabic text.
RUN apt-get update && apt-get install -y --no-install-recommends \
      texlive-latex-base \
      texlive-latex-recommended \
      texlive-latex-extra \
      texlive-fonts-recommended \
      texlive-science \
      texlive-pictures \
      texlive-plain-generic \
      texlive-xetex \
      texlive-lang-cjk \
      texlive-lang-arabic \
      texlive-lang-european \
      texlive-lang-german \
      texlive-lang-french \
      texlive-lang-spanish \
      texlive-lang-italian \
      texlive-lang-portuguese \
      lmodern \
      cm-super \
      dvisvgm \
      ghostscript \
      poppler-utils \
      graphviz \
      librsvg2-bin \
      python3 \
      python3-matplotlib \
      python3-numpy \
      python3-scipy \
      python3-sympy \
      fonts-dejavu \
      fonts-liberation \
      fonts-noto-core \
      fonts-noto-cjk \
      fonts-noto-mono \
      fontconfig \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Caches built now, so the first render needs nothing it would have to fetch
# or write outside the user's home: font list, TeX file database, and
# Matplotlib's font cache in a shared, writable config dir.
ENV MPLBACKEND=Agg \
    MPLCONFIGDIR=/opt/studyos-render/mpl
RUN fc-cache -f \
    && mktexlsr \
    && mkdir -p "$MPLCONFIGDIR" \
    && python3 -c "import matplotlib.pyplot as plt, matplotlib.font_manager as fm; fm.findfont('DejaVu Sans'); plt.plot([0,1]); plt.savefig('/tmp/warm.png')" \
    && chmod -R a+rwX /opt/studyos-render \
    && rm -f /tmp/warm.png

# A non-root user whose home is where renders run (the runner writes inputs
# and out/ relative to it).
RUN useradd --create-home --shell /bin/bash daytona || true
USER daytona
WORKDIR /home/daytona

# Smoke test at build time, as the sandbox user, with exactly the commands
# the render skill tells the agent to use: a build that cannot render fails
# here, not in front of a student.
RUN set -eux; mkdir -p /tmp/smoke/out; cd /tmp/smoke; \
    printf '%s\n' \
      '\documentclass[border=6pt,preview]{standalone}' \
      '\usepackage{amsmath,amssymb,mathtools,siunitx,mhchem,tikz,pgfplots,circuitikz}' \
      '\pgfplotsset{compat=1.18}' \
      '\begin{document}' \
      '$x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}$ \ce{H2O} \SI{9.81}{\metre\per\second\squared}' \
      '\begin{tikzpicture}\begin{axis}[width=4cm]\addplot{x^2};\end{axis}\end{tikzpicture}' \
      '\end{document}' > eq.tex; \
    pdflatex -interaction=nonstopmode -halt-on-error -no-shell-escape eq.tex; \
    pdftoppm -png -r 300 -singlefile eq.pdf out/eq; \
    latex -interaction=nonstopmode -halt-on-error eq.tex && dvisvgm --no-fonts eq.dvi -o out/eq.svg; \
    printf '%s\n' \
      '\documentclass[border=6pt,preview]{standalone}' \
      '\usepackage{xeCJK}' \
      '\setCJKmainfont{Noto Serif CJK SC}' \
      '\begin{document}二次方程式 $x^2$\end{document}' > cjk.tex; \
    xelatex -interaction=nonstopmode -halt-on-error -no-shell-escape cjk.tex; \
    printf '%s\n' \
      '\documentclass[border=6pt,preview]{standalone}' \
      '\usepackage{fontspec}' \
      '\newfontfamily\arabicfont[Script=Arabic]{Noto Naskh Arabic}' \
      '\begin{document}{\arabicfont معادلة}\end{document}' > ar.tex; \
    xelatex -interaction=nonstopmode -halt-on-error -no-shell-escape ar.tex; \
    printf '%s\n' \
      'import numpy as np, scipy, sympy, matplotlib.pyplot as plt' \
      'x = np.linspace(0, 6.3, 200); plt.plot(x, np.sin(x)); plt.title("sin x")' \
      'plt.savefig("out/plot.png", dpi=200, bbox_inches="tight")' > plot.py; \
    python3 plot.py; \
    printf 'digraph G { a -> b; }\n' > graph.dot; \
    dot -Tpng -Gdpi=200 graph.dot -o out/graph.png; \
    neato -Tsvg graph.dot -o out/graph.svg && rsvg-convert out/graph.svg -o out/graph2.png; \
    pdftocairo -png -singlefile eq.pdf out/eq2; \
    ls -la out; cd /; rm -rf /tmp/smoke

# The toolchain version the app checks before every render
# (src/lib/ai/sandbox/toolchain.ts RENDER_IMAGE_VERSION). Written last, so an
# image that failed any step above never claims it.
USER root
RUN printf 'studyos-render-image 2\n' > /etc/studyos-render-image && chmod 0644 /etc/studyos-render-image
USER daytona

CMD ["sleep", "infinity"]
