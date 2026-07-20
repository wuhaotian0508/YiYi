# YiYi Style Calibration Research Decision

This note records the research judgment behind the current cold-start calibration. It is not a claim that the six-look set has been psychometrically validated with people.

## Product question

YiYi needs enough early evidence to improve a recommendation from a small personal wardrobe without turning first use into a fashion survey. The target is **what the user would actually wear**, not photo attractiveness, model appeal, brand aspiration, trend knowledge, or a single permanent style label.

## Relevant evidence

- Bradley and Terry's paired-comparison model establishes why relative choices can recover preference more reliably than isolated ratings when items share a comparison frame. Source: *Rank Analysis of Incomplete Block Designs: I. The Method of Paired Comparisons* (1952), https://doi.org/10.2307/2334029.
- Best-Worst / MaxDiff methods extract more ordering information from small sets, but require choosing extremes among several alternatives. Source: Marley and Louviere, *Some probabilistic models of best, worst, and best-worst choices* (2005), https://doi.org/10.1016/j.jmp.2005.05.003.
- Stitch Fix's public Algorithms Tour describes an editable upfront style profile calibrated for useful data with low client effort, then combines explicit clothing attributes with later behavioral feedback for cold start. It is a mature-product pattern, not code or an implementation dependency: https://algorithms-tour.stitchfix.com/.
- Lu et al. show that a small set of user-specific preference anchors, shrunk toward general evidence, is better suited to outfit cold start than one overconfident average when a new user has fewer than five examples. Source: *Personalized Outfit Recommendation With Learnable Anchors*, CVPR 2021, https://openaccess.thecvf.com/content/CVPR2021/html/Lu_Personalized_Outfit_Recommendation_With_Learnable_Anchors_CVPR_2021_paper.html.
- RecList's behavioral-testing approach motivates checking asymmetric and cold-start invariants rather than treating aggregate accuracy as proof of correct recommendation semantics: https://github.com/RecList/reclist (Apache-2.0).

## Options considered

### Single-card “Would you wear this?”

Rejected as the primary method. It is fast but offers no comparison frame, encourages continuous positive answers, and confounds outfit preference with the photo. It remains in the gated lab as a baseline.

### Forced A/B pairwise choice

Rejected in its pure form. Relative choice is useful, but forcing a winner converts indifference, broad taste, or uncertainty into false evidence.

### MaxDiff / best-worst sets

Not adopted for P0. It can yield more ordering information, but four-look sets are harder to inspect on an iPhone, reintroduce image-scale problems, and ask for precision that six controlled concepts cannot support. This decision is about first-use burden, not a claim that MaxDiff is statistically inferior.

### Pairwise with absolute escape hatches

Adopted: A, B, Both, Neither, and Skip. Four base pairs bound the normal path; at most two predetermined follow-ups appear only when confidence remains low. This is **confidence-gated follow-up**, not full active learning: the current catalog does not optimize the next question online.

## Data semantics

- A or B: selected look is positive relative evidence; the unselected look remains Unknown.
- Both: two lower-confidence positive signals and low differentiation.
- Neither: two explicit, editable, soft negative full-look signals. It does not create the mathematical opposite as a positive style.
- Skip or omission: no evidence.
- Every signal stores provenance, confidence, scope, permanence, editability, and status.
- Only active canonical signals affect recommendation. Ambiguous language is `needs_review`; one onboarding answer never becomes a hard avoid.
- Positive evidence forms a small set of semantic anchors and a confidence-shrunk projection. Negative full-look evidence contributes a bounded outfit-level penalty when a candidate actually matches the rejected semantics.

## Presentation controls

The v2 boards use matched faceless mannequins, neutral background, full-outfit framing, common dimensions, and no requested branding. At runtime a session-stable seed alternates canonical A/B across left and right. The source halves are repositioned without mirroring the clothes, and every new response records the actual order. The lab can replay A-left and B-left while preserving canonical answers.

These measures reduce obvious model, crop, photography, and position confounds. They do not remove synthetic-render bias, body-proportion bias, western contemporary wardrobe coverage, source-side generation artifacts, or garment-feature covariance within each axis. Human counterbalanced testing remains necessary.

## Why the current representation fits YiYi

YiYi has one user, a small local wardrobe, little early evidence, and no shared-item interaction graph. A deterministic TypeScript profile with a few semantic anchors, honest confidence shrinkage, explicit provenance, and behavioral tests is appropriate. Collaborative filtering, contextual bandits, a trained preference service, and a full adaptive questionnaire would add unsupported complexity and could increase decision burden before there is enough data to justify them.
