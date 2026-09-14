# On Continuous Scroll Alignment for Dual-Pane Manuscript Editors

**Ada Lovelace†, Alan Turing‡, and Grace Hopper§**

†Analytical Engine Lab ‡Manchester Computing §UNIVAC Research  
Correspondence: `vellum-demo@example.org`

---

## Abstract

We study the problem of keeping a source editor and a paginated preview visually co-located while the user scrolls. Naïve percentage mapping fails when page margins insert empty space that has no counterpart in the source. Absolute fragment anchoring preserves identity but introduces discontinuous jumps at page boundaries. We propose a monotone piecewise-linear map between pane scroll offsets whose anchors place corresponding block centers at each viewport midpoint. Page gaps become local speed changes rather than discontinuities. Experiments on synthetic manuscripts with mixed prose, tables, lists, and display mathematics show stable mid-pane alignment within a few pixels and continuous preview motion under uniform editor scrolling.

**Keywords:** scroll synchronization, pagination, dual-pane editors, KaTeX, GFM

## 1. Introduction

Manuscript tools increasingly present Markdown (or a similar lightweight markup) beside a print-faithful preview. Authors expect the sentence under their eyes in the editor to appear at a comparable height in the preview. That expectation breaks as soon as the preview inserts non-content geometry: running headers, page margins, and inter-sheet gaps.

Let $e \in [0, e_{\max}]$ be the editor scroll offset and $p \in [0, p_{\max}]$ the preview scroll offset. A map $f: e \mapsto p$ is *continuous* if small changes in $e$ never produce large instantaneous jumps in $p$, and *identity-preserving* if content that sits at the vertical center of the editor also sits at the vertical center of the preview.

Prior systems typically choose one of two extremes:

1. **Progress compression.** Collapse page gaps out of the preview coordinate so that $p$ tracks document progress. Motion is smooth, but corresponding elements drift by hundreds of pixels.
2. **Absolute tops.** Set $p$ from fragment tops in preview coordinates. Identity near the top of each pane is good, yet crossing a page gap forces a jump of roughly one margin stack.

This note develops a third design: build anchors $(e_i, p_i)$ that center fragment $i$ in both viewports, then interpolate linearly. Gaps inflate $|p_{i+1}-p_i|$ relative to $|e_{i+1}-e_i|$, so the preview accelerates through empty paper without teleporting.

## 2. Related Work

Dual-pane Markdown previews are common in desktop editors. Many use proportional scroll sync, which is adequate for continuous HTML previews but not for sheet-oriented pagination. Print CSS engines such as Paged.js materialize discrete pages; scroll containers therefore include non-document vertical ranges.

In cartography and timeline UIs, similar problems appear when a dense axis is paired with a sparse annotated track. Piecewise-linear warping and rubber-sheet registration are classical remedies. Our contribution is to instantiate that idea for editor↔preview scroll with fragment-level anchors derived from a shared logical block map.

## 3. Preliminaries

### 3.1 Logical blocks and fragments

The source is partitioned into top-level Markdown blocks $B_0,\ldots,B_{n-1}$ with source ranges $[s_j, t_j)$. After pagination, each block yields one or more *fragments* $F_{j,k}$ with preview top $y_{j,k}$ and height $h_{j,k}$. Split blocks (a paragraph straddling two pages) contribute multiple fragments whose content heights sum to the logical block height used for relative positioning.

### 3.2 Center scroll targets

Write $H_e$ and $H_p$ for the editor and preview client heights. For a fragment with preview geometry $(y,h)$ and a corresponding editor span with top $u$ and height $v$, the scroll offsets that place the fragment center at each pane midpoint are

$$
e^\star = \mathrm{clamp}\!\left(u + \tfrac{v}{2} - \tfrac{H_e}{2},\, 0,\, e_{\max}\right),
\qquad
p^\star = \mathrm{clamp}\!\left(y + \tfrac{h}{2} - \tfrac{H_p}{2},\, 0,\, p_{\max}\right).
$$

When a block splits, we distribute the editor span proportionally to fragment content heights so that each fragment receives a distinct $e^\star$.

## 4. Method

### 4.1 Anchor construction

Order all fragments by document position. Emit endpoints $(0,0)$ and $(e_{\max}, p_{\max})$, and for each fragment emit $(e^\star, p^\star)$. If the resulting editor abscissae are not strictly increasing, push later samples by a tiny $\varepsilon > 0$ (and likewise for preview ordinates). The result is a strictly monotone polyline.

### 4.2 Evaluation

Given editor scroll $e$, locate the unique segment $[e_i, e_{i+1}]$ containing $e$ and set

$$
p = p_i + \frac{e - e_i}{e_{i+1}-e_i}(p_{i+1}-p_i).
$$

The inverse map uses the same vertices with axes swapped. Near the extremes we snap within half a pixel of $0$ or the maximum so floating-point scroll maxima still pin both panes.

### 4.3 Variable speed interpretation

Differentiate formally on an open segment:

$$
\frac{\mathrm{d}p}{\mathrm{d}e} = \frac{p_{i+1}-p_i}{e_{i+1}-e_i}.
$$

Dense prose with matching line metrics yields ratios near one. A page gap between $F_i$ and $F_{i+1}$ enlarges the numerator, so the preview races through blank paper while the editor advances only one logical step. The trajectory remains continuous: there is no single-frame teleport.

## 5. Implementation notes

Our prototype (Vellum) renders GitHub Flavored Markdown with `markdown-it`, including tables, strikethrough, autolinks, and task lists. Display and inline TeX are compiled with KaTeX through `@vscode/markdown-it-katex`. Pagination uses Paged.js; fragment geometry is measured after layout against the preview scroller.

The editor is CodeMirror 6. A short padding of two line-heights at the top and bottom of the content replaces full-viewport `scrollPastEnd`, which previously distorted end-of-document centering. The center map rebuilds whenever pagination finishes or the pane pair is resized.

### 5.1 Worked scalar example

Suppose three consecutive headings occupy editor centers at $e \in \{120, 160, 200\}$ while preview centers land at $p \in \{140, 420, 460\}$ because a sheet boundary sits between the first and second heading. Then on $[120,160]$ the slope is $(420-140)/(160-120)=7$, and on $[160,200]$ the slope returns to $1$. Scrolling the editor at constant speed produces a brief preview sprint, then ordinary tracking—without a jump discontinuity at the gap.

## 6. Experimental setup

We evaluate on this manuscript itself: mixed headings, equations, a comparison table, task lists, code, and extended prose sized to occupy on the order of ten A4 pages at the default Vellum stylesheet (11 pt body, 20 mm margins). For each trial we scroll the editor to fractions $\{0.1,0.25,0.5,0.75,0.9\}$ of $e_{\max}$, wait for sync, and measure the screen-$Y$ difference between the editor line nearest the window midpoint and the matching preview fragment.

Continuity is probed by advancing the editor in 20 px steps and recording $\Delta p$. We require $\Delta p \ge 0$ always and disallow single-step jumps larger than a full page gap unless the corresponding editor step actually spans that gap in the anchor polyline (in which case $\Delta p$ is large but still the integral of a finite slope).

## 7. Results and discussion

Qualitatively, mid-pane identities remain matched: the heading or paragraph under the caret region is the same object visible at the preview midline. Residual error is typically on the order of a few pixels and is explained by chrome differences (gutter width, KaTeX vertical metrics) rather than map discontinuities.

Page boundaries no longer flash the preview to a distant sheet. Instead the preview momentarily scrolls faster—an effect analogous to turning a physical page while keeping one’s finger on the same sentence in a linear notebook.

Bidirectional sync uses the inverse polyline. Pinning either pane to $0$ or its maximum forces the other to the corresponding endpoint, which restores the familiar “top means top, bottom means bottom” affordance that pure mid-center maps otherwise soften.

### 7.1 Comparison table

| Strategy | Mid-pane identity | Motion at page gaps | Notes |
| --- | --- | --- | --- |
| Progress % | Poor (large drift) | Smooth | Ignores absolute geometry |
| Absolute tops | Good near tops | Jump | Gap enters $p$ abruptly |
| Center polyline (ours) | Good at midlines | Continuous acceleration | Rebuild on layout/resize |

### 7.2 Checklist for interactive validation

- [x] Editor → preview mid alignment on long prose
- [x] Preview → editor inverse tracking
- [x] No negative $\Delta p$ under monotonic editor scroll
- [ ] Human A/B against percentage sync on this PDF-like preview
- [ ] Broader corpora (slides, very wide tables)

## 8. Threats to validity

Fragment detection depends on stable `data-vellum-anchor` wrappers. Concurrent Paged.js runs can duplicate page roots; the prototype serializes layout and trims duplicated fragment streams. Extremely tall blocks taller than a viewport cannot place their geometric center on-screen; clamping then weakens the literal center invariant near those blocks, though neighboring anchors still constrain the polyline.

KaTeX display equations introduce large atomic heights. They are beneficial stress cases for variable speed because a single editor paragraph may map to a tall preview fragment.

## 9. Extended discussion: why midpoints

Top-of-viewport sync is attractive when both panes show the same chrome density. In a Markdown source, however, a heading is one short line, while the preview heading may be large and followed by a deep margin before body text. Aligning tops makes the *next* body sentence appear at mismatched heights. Midpoint alignment targets the user’s attentional center—the region most likely to host the sentence being edited.

Formally, let $c_e(e)$ be the logical content under the editor midline at scroll $e$, and $c_p(p)$ likewise for the preview. We seek $p=f(e)$ such that $c_e(e)=c_p(p)$ whenever both midlines intersect the same block interior. The polyline construction satisfies this exactly at anchors and approximately between them under slowly varying metrics.

## 10. Further prose for pagination depth

### 10.1 On measurement

Measuring fragment tops with `getBoundingClientRect` relative to the scroll container automatically accounts for CSS transforms used to fit pages into a narrow pane. Care is required when an offscreen double-buffer hosts layout: geometry must be read from the buffer that will become visible, after fonts and KaTeX have settled.

### 10.2 On monotone repair

If two fragments share nearly identical editor centers (for example, an empty paragraph collapsed by the editor’s line metrics), $\varepsilon$-inflation preserves invertibility at the cost of a microscopic local distortion. In practice $\varepsilon = 10^{-3}$ is invisible.

### 10.3 On human factors

Users describe percentage sync as “smooth but wrong” and absolute sync as “right until it jumps.” Variable-speed continuous sync is occasionally noticed as a brief preview flourish at page turns; informal feedback suggests that flourish is preferable to losing one’s place.

Lorem expansions follow to pad toward a ten-page sheet count while remaining vaguely on-topic.

Pagination systems must decide whether blank paper is part of the document. For printing, yes; for reading sync, no. Our map keeps blank paper in the preview coordinate system—so scrollbars reflect true sheet stacks—while refusing to treat those ranges as logical progress in the editor.

When authors insert a full-width table near a page break, Paged.js may move the entire table. The fragment map updates after layout; the center polyline is rebuilt; sync resumes without manual recalibration. This reactivity is essential for live editing.

Mathematical writing benefits disproportionately from mid sync. Display equations are rare in the source (a few lines of TeX) yet dominate vertical space in the preview. Anchoring their centers prevents the surrounding prose from appearing to “slip” when the equation enters the midline.

Code fences behave similarly: a twenty-line listing is short in monospace source leading but tall once styled. The polyline allocates editor range by source span and preview range by fragment height, so scrolling through a listing advances the preview faster—again continuously.

Block quotes and lists add minor density changes. Task-list checkboxes, strikethrough, and autolinked URLs exercise GFM inline rules without affecting the block map beyond ordinary paragraph geometry.

Consider a long methodological section. The author skims headings in the editor while watching figures and equations slide by in the preview. With continuous center mapping, each heading’s appearance at the editor mid coincides with its appearance at the preview mid, even when intervening figures differ wildly in height.

We repeat the observation for completeness. Continuous maps with variable speed reconcile two user stories that previously fought each other: “don’t jump” and “keep this sentence lined up.” Absolute geometry supplies identity; piecewise linearity supplies continuity; midpoints supply a perceptually meaningful invariant.

Additional paragraphs intentionally lengthen the manuscript. Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae. Donec velit neque, auctor sit amet aliquam vel, ullamcorper sit amet ligula. Curabitur aliquet quam id dui posuere blandit. Nulla quis lorem ut libero malesuada feugiat. Nulla porttitor accumsan tincidunt. Curabitur arcu erat, accumsan id imperdiet et, porttitor at sem.

Proin eget tortor risus. Vivamus magna justo, lacinia eget consectetur sed, convallis at tellus. Pellentesque in ipsum id orci porta dapibus. Curabitur aliquet quam id dui posuere blandit. Donec rutrum congue leo eget malesuada. Vivamus suscipit tortor eget felis porttitor volutpat.

Mauris blandit aliquet elit, eget tincidunt nibh pulvinar a. Sed porttitor lectus nibh. Curabitur non nulla sit amet nisl tempus convallis quis ac lectus. Praesent sapien massa, convallis a pellentesque nec, egestas non nisi. Vestibulum ac diam sit amet quam vehicula elementum sed sit amet dui.

Quisque velit nisi, pretium ut lacinia in, elementum id enim. Donec sollicitudin molestie malesuada. Nulla quis lorem ut libero malesuada feugiat. Curabitur arcu erat, accumsan id imperdiet et, porttitor at sem. Pellentesque in ipsum id orci porta dapibus.

Cras ultricies ligula sed magna dictum porta. Curabitur aliquet quam id dui posuere blandit. Praesent sapien massa, convallis a pellentesque nec, egestas non nisi. Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia Curae; Donec velit neque, auctor sit amet aliquam vel, ullamcorper sit amet ligula.

## 11. Mathematical digression

The Gaussian integral used as a smoke test for TeX rendering is

$$
\int_{-\infty}^{\infty} e^{-x^2}\,\mathrm{d}x = \sqrt{\pi}.
$$

A compact Maxwell set appears as

$$
\begin{aligned}
\nabla \cdot \mathbf{E} &= \frac{\rho}{\varepsilon_0}, \\
\nabla \cdot \mathbf{B} &= 0, \\
\nabla \times \mathbf{E} &= -\frac{\partial \mathbf{B}}{\partial t}, \\
\nabla \times \mathbf{B} &= \mu_0\mathbf{J} + \mu_0\varepsilon_0\frac{\partial \mathbf{E}}{\partial t}.
\end{aligned}
$$

Inline references such as $\alpha$-scaled learning rates $\eta_t = \eta_0 / \sqrt{t}$ ensure KaTeX participates in ordinary paragraphs, not only display blocks.

### 11.1 Discrete map error

If anchors are exact, the only interpolation error between $e_i$ and $e_{i+1}$ is the mismatch between linear $p(e)$ and the true (generally nonlinear) center locus. Empirically that residual stays small for prose-like metrics. Pathological cases—rapid alternation of tiny and huge fragments—increase chordal error; denser anchors (e.g., per line) would reduce it at higher bookkeeping cost.

## 12. Systems checklist

```ts
type CenterScrollMap = {
  editorMax: number;
  previewMax: number;
  toPreview: (e: number) => number;
  toEditor: (p: number) => number;
};
```

Rebuild after `onLayoutReady` and on `ResizeObserver` ticks. Sync on scroll via `requestAnimationFrame` coalescing, with a short lock so programmatic updates do not echo.

## 13. Conclusion

Continuous center-anchored scroll maps give dual-pane manuscript editors a practical compromise: mid-pane co-location without page-boundary teleportation. The implementation is a short polyline over measured fragments, with inverse evaluation for preview-driven navigation. We recommend this construction whenever a paginated preview is paired with a linear source editor.

### Acknowledgments

This dummy paper exists solely to exercise Vellum’s pagination and sync pipeline. Any resemblance to real research is coincidental and appreciated.

### References

1. CommonMark Spec. https://spec.commonmark.org/
2. GitHub Flavored Markdown Spec. https://github.github.com/gfm/
3. KaTeX documentation. https://katex.org/
4. Paged.js documentation. https://pagedjs.org/

---

## Appendix A. Extra pagination filler

Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo. Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur magni dolores eos qui ratione voluptatem sequi nesciunt.

Neque porro quisquam est, qui dolorem ipsum quia dolor sit amet, consectetur, adipisci velit, sed quia non numquam eius modi tempora incidunt ut labore et dolore magnam aliquam quaerat voluptatem. Ut enim ad minima veniam, quis nostrum exercitationem ullam corporis suscipit laboriosam, nisi ut aliquid ex ea commodi consequatur.

At vero eos et accusamus et iusto odio dignissimos ducimus qui blanditiis praesentium voluptatum deleniti atque corrupti quos dolores et quas molestias excepturi sint occaecati cupiditate non provident, similique sunt in culpa qui officia deserunt mollitia animi, id est laborum et dolorum fuga.

Et harum quidem rerum facilis est et expedita distinctio. Nam libero tempore, cum soluta nobis est eligendi optio cumque nihil impedit quo minus id quod maxime placeat facere possimus, omnis voluptas assumenda est, omnis dolor repellendus.

Temporibus autem quibusdam et aut officiis debitis aut rerum necessitatibus saepe eveniet ut et voluptates repudiandae sint et molestiae non recusandae. Itaque earum rerum hic tenetur a sapiente delectus, ut aut reiciendis voluptatibus maiores alias consequatur aut perferendis doloribus asperiores repellat.

## Appendix B. Final remarks

Scroll sync is ultimately a human interface problem disguised as geometry. The right invariant is not “equal percentages” but “the thing I am looking at.” Midpoint anchors encode that invariant; continuity keeps trust when the preview must traverse paper the source does not contain.

Finis.
