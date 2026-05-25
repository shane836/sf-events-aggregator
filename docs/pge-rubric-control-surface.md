# Why PGE Works and What Makes an Effective Rubric

**Author:** Alessandro Di Leo + Claude (AIOS PRD workshop, 2026-05-20)
**Context:** Derived from first-principles analysis of LLM transformer architecture applied to agentic AI system design.

---

## The Problem PGE Solves

A large language model generates one token at a time. Each token gets exactly one forward pass through the network — the same computation whether the problem is trivial or complex. The model can't go back and revise earlier tokens. It can't reliably assess its own output. And its training objective rewards plausible-sounding output, not correct output.

These aren't bugs. They're architectural properties of transformer-based LLMs:

| Property | What it means | Why it matters |
|---|---|---|
| **Autoregressive generation** | One token at a time, each conditioned on all prior tokens, can't revise | Early errors propagate. Wrong framing at token 15 shapes the entire response. (Vaswani et al. 2017) |
| **Fixed compute per step** | One forward pass per token regardless of problem complexity | A complex multi-constraint decision gets the same computation as "the capital of France is ___" (Wei et al. NeurIPS 2022 — CoT as workaround) |
| **RLHF reward misalignment** | Post-training rewards confident, agreeable, concise output | The model is optimized to sound right, not to be right. Hedging scores lower than confident wrong answers ~45% of the time (Sharma et al. ICLR 2024) |
| **Knowledge boundary blindness** | No reliable "I don't know" circuit | Entity-recognition features suppress the refusal circuit even without actual knowledge (Anthropic, Attribution Graphs 2025) |
| **Non-determinism** | Identical inputs produce different outputs across runs | Can't verify by re-running — different run, different answer |
| **Next-token likelihood objective** | Training target: predict most likely continuation, not most true | "Sounds right" and "is right" are independent variables. Even with correct knowledge, the highest-likelihood continuation can be a fabrication (Kalai et al. OpenAI 2025) |

Given these properties, a single-pass generate-and-ship pipeline is architecturally gambling. The model WILL hallucinate (three independent impossibility proofs: Xu et al. 2024, Kalai & Vempala 2024, Karpowicz 2025). It WILL take shortcuts (RLHF rewards adequacy equally with thoroughness). It WILL be confident about wrong answers (reward signal pushes confident output even on uncertain claims). And it CAN'T reliably catch itself (autoregressive commitment means errors in context become "facts" for subsequent tokens — Zhang & Press 2023 showed models catch 67% of their own errors in isolation but can't during generation because the error is already in context).

## How PGE Addresses This

PGE (Planner-Generator-Evaluator) separates the three things a single model can't do well simultaneously:

```
PLANNER    →  Decomposes complex problems into steps the generator can handle
               (addresses fixed-compute-per-step limitation)

GENERATOR  →  Produces output for each step by reasoning over presented context
               (exploits the model's actual strength)

EVALUATOR  →  Checks output against criteria from OUTSIDE the generation context
               (addresses self-assessment failure)

Loop: generate → evaluate → revise → re-evaluate → converge
```

**Why each role exists (mapped to architectural properties):**

### Planner

The model gets one forward pass per token. A problem requiring N units of reasoning can't be solved in one pass. The planner converts it into N steps, each within single-pass capacity.

This is why chain-of-thought prompting works (Wei et al. "Chain-of-Thought Prompting Elicits Reasoning in Large Language Models," NeurIPS 2022): generating intermediate reasoning tokens gives the model additional forward passes. The planner externalizes this — instead of hoping the model self-decomposes, the planner structures the decomposition.

Without a planner: the model pattern-matches the most statistically common answer shape and skips multi-step reasoning. The output looks like a decision; it's a pattern completion.

### Generator

The generator does what the model is actually good at: reasoning over information that's PRESENTED in its context window. The key insight: the model's core capability is compositional inference over loaded information. It is NOT good at following behavioral instructions to do things ("always verify," "be thorough" — these hit the compliance ceiling).

Design principle: **present context, let the model reason.** Don't instruct the model to go find information (compliance ceiling). Have the planner or tools gather information and present it in context. The model reasons over what it sees.

This is supported by the in-context learning literature (Brown et al. NeurIPS 2020 — GPT-3; Xie et al. 2022 — "ICL as Implicit Bayesian Inference"). The model's frozen weights define a function space; the context selects which function is active. The generator's job is to reason within the function space the context selects.

### Evaluator

The generator can't assess its own output because:

1. **Autoregressive commitment (snowball):** The generator's output is in its own context. It treats its prior tokens as ground truth. Asking the generator "was your output correct?" is asking it to evaluate while anchored on the output it just produced. Zhang & Press (2023) demonstrated this directly: ChatGPT could identify 67% of its own mistakes when shown in isolation, but couldn't catch them during generation.

2. **RLHF agreement bias:** If the evaluator is the same model in the same context, RLHF pushes it toward agreeing with the prior output. Sharma et al. (ICLR 2024) measured: models flip from correct to incorrect answers 42-98% of the time when challenged. Once sycophantic agreement is established, it persists at 78.5% regardless of context.

3. **Confidence-accuracy decoupling:** Models CAN internally distinguish what they know from what they don't (Kadavath et al. 2022 — P(True) self-evaluation), but RLHF training pushes confident presentation that overrides the calibration. The evaluator needs to bypass this miscalibration.

The architectural solution: the evaluator operates in a **separate context** from the generator. It hasn't generated the output, isn't anchored on it, and isn't subject to the snowball effect. It examines the output as an external artifact, not as its own prior work.

This is why Reflexion (Shinn et al. NeurIPS 2023) works: the evaluator provides feedback from outside the generation context, and subsequent generation incorporates the feedback as new input rather than defending prior output.

### The Loop

The loop (generate → evaluate → revise) addresses non-determinism. Any single generation might be wrong. The loop gives the system multiple chances to converge. Each evaluation identifies specific failures; each revision targets those failures. Quality improves monotonically if the evaluator is reliable.

**But the loop only converges if the evaluator is actually checking the right things.** An evaluator that says "looks good" on every pass = the loop runs but never improves. An evaluator with vague criteria = the loop oscillates (fixes one thing, breaks another, round-trips forever).

This is where the rubric comes in.

---

## The Rubric Is the Control Surface

Without a rubric, the evaluator is "a model judging a model." This hits every architectural failure mode the evaluator was supposed to address:

- The evaluator has the same RLHF confidence bias as the generator
- The evaluator has the same compliance ceiling on behavioral instructions
- The evaluator defaults to agreement (sycophancy) when asked "is this good?"
- The evaluator can't distinguish "plausible" from "correct" without external criteria

**A rubric converts the evaluator from vibes-based judgment to criteria-based verification.**

```
Without rubric:  "Is this output good?"  →  model judges plausibility  →  "yes"  →  ships

With rubric:     "Does dimension 1 pass?" →  deterministic check  →  FAIL
                 "Does dimension 2 pass?" →  source comparison    →  PASS
                 "Does dimension 3 pass?" →  requirement check    →  PASS
                 Result: 2/3 pass, dimension 1 fails  →  specific revision target
```

The rubric is to the evaluator what a test suite is to code. Without tests, "the code works" is a developer's assertion. With tests, "the code passes these specific checks" is structural verification.

### What Makes an Effective Rubric

An effective rubric has four properties, each derived from the architectural properties above:

**1. Specific dimensions (each targeting a failure mode)**

Each rubric dimension should target a SPECIFIC way the output can be wrong. Not "quality" — which failure mode are you checking for?

| Vague dimension | Specific dimension | Failure mode targeted |
|---|---|---|
| "Is the analysis thorough?" | "Does the output address all 5 stated requirements?" | Effort minimization (model skips requirements) |
| "Are the numbers right?" | "Do numerical claims match independent computation?" | Hallucination on arithmetic (tokenization limitation) |
| "Is this well-sourced?" | "Does each factual claim cite a source that actually contains the claim?" | Citation hallucination (model fabricates sources) |
| "Is the reasoning sound?" | "Does the conclusion follow from the stated premises without unstated assumptions?" | Unfaithful reasoning (plausible chain, wrong conclusion) |
| "Is this accurate?" | "Do entity attributions match the cited source?" (Person A said X — did Person A actually say X?) | Conflation (real entities merged incorrectly) |

**2. Matched check methods (reliability appropriate to the failure mode)**

Different dimensions need different verification methods. The check method should match the reliability level the failure mode requires:

| Check method | Reliability | Use when |
|---|---|---|
| **Deterministic comparison** (compute answer independently, compare) | Highest | Numerical claims, date calculations, format validation, schema compliance |
| **Source comparison** (check claim against cited document) | High | Factual claims, entity attributions, direct quotes |
| **Structural check** (verify presence/absence of required elements) | High | Completeness (all requirements addressed), format compliance, required fields |
| **Model judgment** (LLM evaluates quality) | Lower (compliance ceiling applies) | Reasoning quality, coherence, relevance, tone. Use ONLY when structural checks aren't possible. |

The key insight: **model judgment is the LAST resort, not the default.** Every dimension that CAN be checked structurally SHOULD be. Model judgment is appropriate for genuinely subjective dimensions (writing quality, relevance, coherence) — but even there, specific criteria outperform vague ones.

This is supported by the compliance ceiling research: SCHEMA 2026 (arXiv:2605.02398) showed 8/11 frontier models collapse 12-30 percentage points under compliance-forcing instructions structurally identical to production agent configs. Behavioral instructions ("evaluate thoroughly") hit this ceiling. Structural checks ("count the requirements, verify each is addressed") don't — they operate outside the model's compliance path.

**3. External ground truth (anchored outside the model)**

A rubric dimension that asks "is this correct?" without specifying WHAT "correct" means lets the evaluator judge plausibility — the same trap as the generator. Effective dimensions reference something OUTSIDE the model:

- "Does the output match the SOURCE DOCUMENT?" (ground truth = the document)
- "Does the numerical result match PYTHON3 COMPUTATION?" (ground truth = deterministic calculation)
- "Does the output address ALL STATED REQUIREMENTS from the input?" (ground truth = the requirement list)
- "Does the citation resolve to A REAL PAPER with the claimed content?" (ground truth = the actual paper)

Without external ground truth, the evaluator is judging the generator's output against the evaluator's own training data — which has the same biases, the same compression losses, and the same plausibility-over-truth optimization.

**4. Independence from the generator's framing**

"Did the generator do a good job?" triggers sycophancy — the evaluator is asked to judge a peer and defaults to agreement (Sharma et al. ICLR 2024: ~45% sycophantic preference on hard questions).

"Does the output satisfy criterion X?" is a factual question about the output, not a judgment of the generator. The evaluator doesn't need to "disagree with" the generator — it just checks criteria.

---

## Concrete Rubric Examples

### Example 1: Financial Analysis Rubric

**Task:** "Analyze Ready Rig's Q1 margins and recommend pricing changes."

| Dimension | Check method | Criterion | Failure mode targeted |
|---|---|---|---|
| All data points sourced | Source comparison | Every dollar amount traces to a named system (QBO, Shopify, Katana) with query/field cited | Hallucination — model invents financial numbers |
| Arithmetic verified | Deterministic | Every calculation reproduced by independent computation (python3). Results match to the cent. | Tokenization failure — model can't do reliable arithmetic |
| All stated requirements addressed | Structural | Output covers: margin analysis, pricing recommendation, impact projection. Each present. | Effort minimization — model skips the hard parts |
| Premises stated explicitly | Structural | Every assumption underlying the recommendation is listed. No unstated premises. | Anchoring — model builds on assumed premises without surfacing them |
| Counter-recommendation included | Structural | Output includes "what could go wrong with this recommendation" section | Sycophancy — model agrees with the implied direction without adversarial check |

**Note:** 4 of 5 dimensions use structural/deterministic checks. Only "premises stated explicitly" requires some model judgment (is this REALLY all the premises?). The rubric is robust because most dimensions don't depend on the evaluator's compliance.

### Example 2: Research Synthesis Rubric

**Task:** "Synthesize findings from 5 papers on ADHD executive function and identify design implications."

| Dimension | Check method | Criterion | Failure mode targeted |
|---|---|---|---|
| All 5 papers represented | Structural count | Each paper appears in the synthesis with at least one finding cited | Effort minimization — model covers 3 of 5 and calls it done |
| Citations resolvable | Source comparison | Every arXiv ID / DOI resolves to a real paper. Paper title matches. | Citation hallucination |
| Quotes are verbatim | Source comparison | Every blockquote verified against the actual paper text | Conflation — quote is real but attributed to wrong paper |
| Design implications grounded | Structural | Each design implication traces to a specific paper finding (not to general knowledge) | Parametric-retrieved conflict — model generates from training data instead of the loaded papers |
| Conflicting findings surfaced | Model judgment (specific) | If papers disagree, the disagreement is named and both positions presented | Sycophancy — model presents false consensus |

### Example 3: Marketing Copy Rubric

**Task:** "Write product description for the Ready Rig Pro."

| Dimension | Check method | Criterion | Failure mode targeted |
|---|---|---|---|
| No banned words | Deterministic (regex) | Output contains zero words from the banned list (revolutionize, game-changing, seamlessly, cutting-edge, etc.) | Effort minimization — model defaults to generic marketing language |
| Claims are hedged | Structural | "Helps reduce" not "eliminates." "Supports" not "guarantees." No absolute claims. | Hallucination — overclaim on product capabilities |
| Product facts correct | Source comparison | Weight, dimensions, compatibility specs match the product entity | Parametric-retrieved conflict — model generates specs from training data |
| Voice match | Model judgment (with examples) | Output matches the voice profile (provide 3 examples of approved copy for comparison) | — (creative dimension, model judgment appropriate) |
| No em dashes | Deterministic (regex) | Zero em dash characters in output | Style compliance |

**Note:** Even a creative task has mostly structural checks. Voice match is the one dimension requiring model judgment — and it's anchored by providing EXAMPLES (in-context learning) rather than asking "does this sound right?"

### Example 4: Code Generation Rubric

**Task:** "Write a Python script that extracts transactions from bank statement PDFs."

| Dimension | Check method | Criterion | Failure mode targeted |
|---|---|---|---|
| Executes without error | Deterministic (run it) | `python3 script.py test_statement.pdf` returns exit code 0 | Code hallucination — fabricated API calls, wrong function signatures |
| Output matches expected | Deterministic (diff) | Output CSV matches the manually-verified expected output for the test file | Unfaithful reasoning — code "looks right" but logic is wrong |
| All transaction types handled | Structural (count) | Test file contains 5 transaction types; output contains all 5 | Effort minimization — handles the common case, skips edge cases |
| No hardcoded paths | Deterministic (grep) | `grep -r "/Users/" script.py` returns empty | Example-bound authoring — model hardcodes the current environment |
| Libraries exist | Deterministic (pip check) | Every import resolves to a real, installable package | Hallucination — model fabricates library names |

**Note:** 5 of 5 dimensions are deterministic. Code is the easiest domain for rubric design because correctness is mechanically verifiable. The rubric IS the test suite.

---

## The Rubric as Control Surface for Agentic Loops

In an agentic system (multi-step, tool-using, potentially multi-agent), the rubric controls WHERE the loop converges. Different rubrics produce different system behaviors from the same architecture:

```
Same PGE loop + financial rubric    → converges on numerical accuracy + source verification
Same PGE loop + creative rubric     → converges on voice match + engagement
Same PGE loop + code rubric         → converges on execution correctness + test passage
Same PGE loop + no rubric           → converges on plausibility (= doesn't converge on quality)
```

The rubric is the SPECIFICATION that converts generic "evaluate quality" into specific "check these failure modes with these methods against these criteria." Change the rubric, change the system's behavior. The architecture stays the same; the rubric is the tuning parameter.

This makes the rubric the highest-leverage artifact in an agentic system. A mediocre architecture with a great rubric outperforms a great architecture with a vague rubric — because the rubric determines what the loop optimizes toward.

### The Meta-Insight

Every rubric dimension is a hypothesis: "this failure mode matters for this task." Every check method is a design choice: "this reliability level is appropriate for this dimension." Every threshold is a trade-off: "this level of quality is acceptable."

The rubric IS the product requirements document for a single operation — the same derivation chain (failure modes → scaffold requirements → constraints) applied at the individual-task level rather than the system level.

---

## Citations

| Source | What it establishes | Relevance |
|---|---|---|
| Vaswani et al. 2017, "Attention Is All You Need" | Transformer architecture: autoregressive, attention-based | Foundation for all root mechanisms |
| Wei et al. NeurIPS 2022, "Chain-of-Thought Prompting" | CoT improves reasoning by externalizing intermediate steps | Why the Planner role helps |
| Shinn et al. NeurIPS 2023, "Reflexion" (arXiv:2303.11366) | Iterative self-refinement with evaluator feedback improves task performance | Why the PGE loop converges |
| Sharma et al. ICLR 2024, "Towards Understanding Sycophancy in LMs" | Models flip positions 42-98% when challenged; sycophancy persists at 78.5% | Why evaluator must be in separate context; why rubric must be criteria-based not judgment-based |
| Zhang & Press 2023 | Models catch 67% of own errors in isolation but not during generation | Why self-evaluation fails within the generation context |
| Kadavath et al. 2022, "Language Models (Mostly) Know What They Know" (arXiv:2207.05221) | Models CAN self-evaluate; RLHF miscalibrates the signal | Why raw model confidence is unreliable; why structural checks outperform model judgment |
| Kalai et al. OpenAI 2025 | Training rewards guessing over acknowledging uncertainty; hallucination impossibility for rare facts | Why hallucination can't be eliminated, only contained |
| Xu et al. 2024 | Infinite questions, finite capacity → hallucination mathematically guaranteed | Impossibility result #1 |
| Kalai & Vempala 2024 | Rare-fact hallucination rate tied to training fraction | Impossibility result #2 |
| Karpowicz 2025 | Quadrilemma: truth/conservation/revelation/helpfulness — pick three | Impossibility result #3 |
| SCHEMA 2026 (arXiv:2605.02398) | 8/11 frontier models collapse 12-30pp under compliance-forcing instructions | Why behavioral instructions ("be thorough") hit a ceiling; why structural checks are more reliable |
| Tam et al. EMNLP 2024 (arXiv:2408.02442) | Structured output degrades reasoning by 63pp in extreme cases | Why the generator should reason freely and structure post-hoc |
| Turpin et al. 2023 (arXiv:2305.04388) | CoT explanations don't always reflect actual decision process | Why you verify the CONCLUSION independently, not the reasoning chain |
| Anthropic, Attribution Graphs 2025 | Entity-recognition features suppress refusal circuit | Why the model generates about topics it doesn't actually know |
| Brown et al. NeurIPS 2020, "Language Models are Few-Shot Learners" | In-context learning: models adapt from examples in context | Why example-based rubric dimensions (voice match) work |

**Note:** Several citations above are from training knowledge and should be verified against primary sources before citing in published work. Citations marked with arXiv IDs are locatable; others may need verification of exact venue/year.

---

## Summary

**PGE works** because each role addresses a specific architectural limitation of the LLM: the planner addresses fixed compute per step, the generator exploits reasoning-over-context (the model's actual strength), and the evaluator addresses the model's inability to reliably assess its own output.

**The rubric is the control surface** because it determines what the evaluator checks, how it checks, and what threshold it accepts. Without a rubric, the PGE loop runs but doesn't converge on quality. With a good rubric, every loop iteration targets a specific failure mode and converges toward the rubric's criteria.

**An effective rubric** has specific dimensions (targeting named failure modes), matched check methods (deterministic where possible, model judgment only as last resort), external ground truth (anchored outside the model), and independence from the generator's framing (criteria-based, not judgment-based).

**The meta-principle:** A rubric is a PRD for a single operation. The same derivation chain that produces system-level design requirements (failure modes → scaffold requirements → constraints) produces operation-level evaluation criteria (rubric dimensions → check methods → thresholds). The methodology is scale-invariant.
