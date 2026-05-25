# PGE Loop Design Guide — Feed This to Claude Code

Use this document as a reference when building agentic workflows. Drop it into your project as a CLAUDE.md include, or paste it when asking Claude to design a PGE (Planner-Generator-Evaluator) loop.

> **Quick start for your workflow:** If you're building pipelines like Excel → Markdown → HTML (interactive pitch decks, sensitivity models, data-driven documents), skip to the rubric examples section — there's a rubric for each stage of that pipeline. The key insight: each transformation step (XLS → JSON, JSON → Markdown, Markdown → HTML) is a separate PGE operation with its own rubric. The planner decomposes the pipeline; each step's evaluator catches failures specific to that transformation.

---

## What is PGE and why does it work?

PGE splits an operation into three roles because a single LLM can't reliably do all three simultaneously:

**Planner** — decomposes a complex problem into steps the generator can handle one at a time. Needed because the model gets fixed computation per token — complex problems exceed single-step capacity (Wei et al. NeurIPS 2022).

**Generator** — produces output by reasoning over context that's been PRESENTED to it (by the planner, by tools, by loaded documents). The model's core strength is reasoning over what it can see. Don't instruct it to go find things — present the information and let it reason.

**Evaluator** — checks the generator's output against specific criteria from OUTSIDE the generation context. The generator can't reliably assess its own output because it's anchored on what it just wrote (Zhang & Press 2023: models catch 67% of own errors in isolation but can't during generation). The evaluator must be independent.

**The loop:** generate → evaluate → specific failures identified → revise those failures → re-evaluate → converge. The loop only converges if the evaluator checks SPECIFIC things. Vague evaluation ("is this good?") = the loop runs without improving.

## How to design a PGE loop

### Step 1: Define the task clearly

State what the operation should produce. List ALL requirements explicitly — unstated requirements can't be checked by the evaluator.

### Step 2: Identify failure modes for THIS task

Ask: what specific ways can this output be wrong? Not "quality" in general — specific failure modes:

- **For factual tasks:** hallucinated facts, wrong numbers, fabricated citations, entity conflation (real facts combined incorrectly), unstated assumptions
- **For code tasks:** fabricated libraries, wrong function signatures, logic errors that pass syntax checks, hardcoded environment-specific values
- **For analysis tasks:** skipped requirements, shallow treatment of hard parts, anchoring on first assumption, missing counterarguments
- **For creative tasks:** generic/template language, wrong voice/tone, overclaims, banned terms
- **For any task with sources:** claims not grounded in the cited source, quotes attributed to wrong source, parametric knowledge overriding the loaded document

### Step 3: Build the rubric

For EACH failure mode, create a rubric dimension with:

1. **What to check** (the dimension — targeting one specific failure mode)
2. **How to check** (the method — matched to the reliability level needed)
3. **What passes** (the criterion — anchored to external ground truth)

**Choose the check method based on reliability needs:**

```
DETERMINISTIC (highest reliability — use whenever possible)
  Run code and check exit code
  Compare numbers against independent computation
  Regex/grep for banned patterns
  Count required elements (are all N present?)
  Diff against expected output

SOURCE COMPARISON (high reliability)
  Check claim against the cited document
  Verify quote is verbatim from source
  Confirm entity attribution (Person A actually said X)
  Compare output against loaded reference material

STRUCTURAL CHECK (high reliability)  
  Verify all stated requirements are addressed (checklist)
  Check output format matches specification
  Verify required sections/fields present
  Count: expected N items, got N items?

MODEL JUDGMENT (lower reliability — last resort)
  Evaluate reasoning quality, coherence, relevance, tone
  ONLY use when structural checks aren't possible
  Make it SPECIFIC: "Does the conclusion follow from premises 
  1-3 without unstated assumptions?" not "Is the reasoning good?"
  Provide EXAMPLES of good/bad for comparison
```

### Step 4: Wire the loop

```python
# Pseudocode for a PGE loop

def pge_loop(task, rubric, max_iterations=3):
    # PLAN: decompose if complex
    steps = planner(task)
    
    for step in steps:
        output = None
        for i in range(max_iterations):
            # GENERATE: produce output (or revision)
            if output is None:
                output = generator(step)
            else:
                output = generator(step, prior_output=output, feedback=evaluation)
            
            # EVALUATE: check against rubric
            evaluation = evaluator(output, rubric)
            
            if evaluation.all_pass:
                break  # converged
            
            # evaluation.failures contains SPECIFIC dimensions that failed
            # next iteration targets THOSE failures
        
        # after max_iterations: ship with annotations on what didn't pass
        results.append(output, evaluation)
    
    return results
```

**Key implementation details:**

- **The evaluator should run in a separate context** (separate agent/sub-agent, not the same conversation). This breaks the sycophancy/anchoring trap — the evaluator hasn't seen the generation reasoning and isn't anchored on it.
- **Pass the rubric to the evaluator, not the task description.** The evaluator's job is checking criteria, not re-doing the task.
- **Each failed dimension becomes specific revision instructions.** Don't say "try again" — say "dimension 3 failed: the output claims $4,400 retail price but the source document says $3,999.99. Revise to match source."
- **Cap iterations.** If the loop hasn't converged after 3 iterations, ship with annotations ("dimensions 2 and 5 did not pass after 3 iterations — flagged for human review"). Don't loop forever.

## Rubric template

Copy and adapt for your specific task:

```markdown
## Rubric for: [task name]

### Dimension 1: [name targeting a specific failure mode]
- Check method: [deterministic / source comparison / structural / model judgment]
- Criterion: [what specifically must be true]
- Ground truth: [what external reference to check against]
- Pass if: [specific condition]
- Fail if: [specific condition]

### Dimension 2: [name]
- Check method: ...
- Criterion: ...
- Ground truth: ...
- Pass if: ...
- Fail if: ...

[repeat for each failure mode relevant to this task]
```

## Example rubrics ready to use

### Financial analysis rubric

```markdown
## Rubric for: Financial analysis

### D1: Data sourcing
- Check method: structural
- Criterion: every dollar amount traces to a named data source with the specific query/field
- Ground truth: the data source itself (QBO, Shopify, bank statement, etc.)
- Pass if: every amount has "[source: X, field: Y]" annotation
- Fail if: any amount lacks source annotation

### D2: Arithmetic verification
- Check method: deterministic
- Criterion: every calculation independently reproduced
- Ground truth: python3 computation of the same inputs
- Pass if: all results match to the cent
- Fail if: any result differs from independent computation

### D3: Requirement coverage
- Check method: structural (count)
- Criterion: output addresses every stated requirement from the prompt
- Ground truth: the original requirement list
- Pass if: all N requirements present in output
- Fail if: any requirement missing or addressed only superficially (< 1 sentence)

### D4: Assumptions surfaced
- Check method: structural
- Criterion: every assumption underlying the analysis is explicitly stated
- Ground truth: N/A (model judgment — "are there unstated assumptions?")
- Pass if: assumptions section present with >= 1 assumption
- Fail if: no assumptions section, or analysis proceeds from unstated premises

### D5: Counterargument present
- Check method: structural
- Criterion: output includes "risks" or "what could go wrong" section
- Ground truth: N/A
- Pass if: counter-section present with specific risks (not generic)
- Fail if: no counter-section, or only generic risks ("market could change")
```

### Research synthesis rubric

```markdown
## Rubric for: Research synthesis from N sources

### D1: Source coverage
- Check method: deterministic (count)
- Criterion: all N provided sources appear in the synthesis
- Ground truth: the list of N source documents
- Pass if: all N sources cited at least once
- Fail if: any source missing

### D2: Citation accuracy
- Check method: source comparison
- Criterion: every cited claim actually appears in the cited source
- Ground truth: the source documents themselves
- Pass if: spot-check of 3 citations all match source content
- Fail if: any citation doesn't match its source

### D3: Verbatim quote fidelity
- Check method: deterministic (diff)
- Criterion: every blockquote is character-for-character accurate
- Ground truth: the original text in the source
- Pass if: all quotes match source
- Fail if: any quote modified, truncated, or combined from multiple sources

### D4: Conflicting findings surfaced
- Check method: model judgment (specific)
- Criterion: if sources disagree on a point, both positions presented
- Ground truth: the sources themselves
- Pass if: disagreements named with both sides cited
- Fail if: false consensus presented when sources actually disagree

### D5: Design implications grounded
- Check method: structural
- Criterion: each recommendation traces to a specific finding (not general knowledge)
- Ground truth: the findings section of the same synthesis
- Pass if: every recommendation cites a specific finding
- Fail if: any recommendation is "general best practice" without source grounding
```

### Code generation rubric

```markdown
## Rubric for: Code generation

### D1: Executes
- Check method: deterministic
- Criterion: code runs without error on test input
- Ground truth: exit code 0
- Pass if: python3 script.py test_input.txt exits 0
- Fail if: any exception

### D2: Correct output
- Check method: deterministic (diff)
- Criterion: output matches expected output for test cases
- Ground truth: manually verified expected output
- Pass if: diff is empty
- Fail if: diff shows differences

### D3: Libraries exist
- Check method: deterministic
- Criterion: every import resolves to a real installable package
- Ground truth: pip install / pip show
- Pass if: all imports installable
- Fail if: any import fails resolution

### D4: No hardcoded paths
- Check method: deterministic (grep)
- Criterion: no absolute paths in code
- Ground truth: grep -r "^/" script.py
- Pass if: grep returns empty
- Fail if: any hardcoded absolute path found

### D5: Edge cases handled
- Check method: deterministic
- Criterion: code handles empty input, malformed input, missing fields
- Ground truth: run against edge-case test inputs
- Pass if: graceful handling (error message or default, not crash)
- Fail if: any edge case crashes
```

### HTML report / document generation rubric

```markdown
## Rubric for: HTML report or document generation

### D1: Renders without errors
- Check method: deterministic
- Criterion: HTML opens in browser with no console errors, no broken layouts
- Ground truth: open in browser, check devtools console
- Pass if: zero console errors, layout matches intended design
- Fail if: any rendering error, broken CSS, missing assets

### D2: Data accuracy
- Check method: source comparison
- Criterion: every number, name, date in the report matches the source data
- Ground truth: the source data (CSV, API response, database query)
- Pass if: spot-check of 5 data points all match source
- Fail if: any data point differs from source

### D3: All sections present
- Check method: structural (count)
- Criterion: report contains all required sections from the spec
- Ground truth: the section list in the report specification
- Pass if: all N sections present with content
- Fail if: any section missing or empty

### D4: Responsive / accessible
- Check method: deterministic
- Criterion: renders correctly at mobile (375px) and desktop (1440px) widths
- Ground truth: browser devtools responsive mode
- Pass if: no horizontal scroll, text readable, charts/tables scale
- Fail if: broken layout at either width

### D5: No hardcoded data
- Check method: deterministic (grep)
- Criterion: data comes from variables/props, not inline literals
- Ground truth: grep for hardcoded values that should be dynamic
- Pass if: all data references use variables
- Fail if: any data value hardcoded that should be dynamic

### D6: Visual hierarchy correct
- Check method: model judgment (with reference)
- Criterion: headers, sections, emphasis match the information hierarchy
- Ground truth: provide a reference design or wireframe for comparison
- Pass if: visual hierarchy matches the reference
- Fail if: key information buried or hierarchy inverted
```

### Data pipeline rubric (Excel → JSON → Markdown → HTML)

For workflows where structured data transforms through multiple stages into interactive output (e.g., interactive pitch decks with sliders feeding from pre-processed XLS). Each stage is a separate PGE operation with its own rubric. The planner decomposes the pipeline; each step's evaluator catches stage-specific failures.

**Stage 1: Excel → JSON (pyxl data extraction)**

```markdown
## Rubric for: XLS data extraction to JSON

### D1: All worksheets/ranges extracted
- Check method: deterministic (count)
- Criterion: every named range / worksheet in the spec produces a JSON output
- Ground truth: the workbook structure
- Pass if: all N data sources present in JSON output
- Fail if: any source missing

### D2: Data type fidelity
- Check method: deterministic (python3 type check)
- Criterion: numbers stay numbers, dates stay dates, strings stay strings
- Ground truth: spot-check 10 cells against JSON values
- Pass if: all types match, numbers within float precision
- Fail if: any type coercion (number → string, date → string without ISO format)

### D3: Formula values resolved
- Check method: deterministic (compare against Excel calculated values)
- Criterion: JSON contains CALCULATED values, not formula text
- Ground truth: open workbook, read calculated values
- Pass if: all formula cells match their calculated result
- Fail if: formula text in JSON, or value differs

### D4: Circular reference handling
- Check method: deterministic
- Criterion: circular-ref cells use Excel's converged iterative-calc value, not #REF/NaN
- Ground truth: Excel with iterative calculation enabled
- Pass if: valid numeric values matching Excel's converged result
- Fail if: #REF, NaN, None, or unconverged
```

**Stage 2: JSON → Markdown (Obsidian content assembly)**

```markdown
## Rubric for: JSON data + Obsidian content → assembled Markdown

### D1: All data bindings resolved
- Check method: deterministic (grep)
- Criterion: zero unresolved template variables in output
- Ground truth: grep for {{variable}} or {data.field} patterns
- Pass if: zero matches
- Fail if: any unresolved binding

### D2: Asset references valid
- Check method: deterministic (file exists)
- Criterion: every image/link/embed points to a file that exists in the vault
- Ground truth: resolve each path
- Pass if: all referenced files exist
- Fail if: any broken reference

### D3: Content hierarchy matches spec
- Check method: structural
- Criterion: heading structure (H1/H2/H3) matches the outline
- Ground truth: the content hierarchy spec
- Pass if: all headings present, correct order and level
- Fail if: missing headings, wrong nesting

### D4: Data values match source JSON
- Check method: deterministic (spot-check 5 values)
- Criterion: randomly selected data values in markdown match source JSON
- Ground truth: the Stage 1 JSON output
- Pass if: all 5 match
- Fail if: any mismatch
```

**Stage 3: Markdown → Interactive HTML (sliders + calculated values)**

```markdown
## Rubric for: Interactive HTML pitch deck with sliders

### D1: Zero console errors
- Check method: deterministic
- Criterion: no JS errors on load AND after interacting with every slider
- Ground truth: browser devtools console
- Pass if: clean console throughout
- Fail if: any error

### D2: Slider calculations correct
- Check method: deterministic (python3 independent calc)
- Criterion: slider at value X → all dependent fields match independent computation with input X
- Ground truth: python3 reproduction of same formula
- Pass if: all calculated values match within display precision
- Fail if: any differs

### D3: Slider ranges valid
- Check method: deterministic
- Criterion: min/max/step match spec, no out-of-domain values allowed
- Ground truth: sensitivity analysis parameters
- Pass if: all sliders match spec
- Fail if: any allows invalid domain

### D4: Reactive updates
- Check method: deterministic (interaction test)
- Criterion: moving any slider updates all dependent tables/charts
- Ground truth: move slider, verify dependents update
- Pass if: all dependents update reactively
- Fail if: stale data after change

### D5: JSON data loads dynamically
- Check method: deterministic
- Criterion: no hardcoded data — change source JSON, reload, output changes
- Ground truth: modify one JSON value, reload
- Pass if: output reflects change
- Fail if: output shows old value (hardcoded)

### D6: Presentation-ready at target sizes
- Check method: deterministic
- Criterion: renders at 1920x1080 (projector) and 1440x900 (laptop)
- Ground truth: responsive mode
- Pass if: no overflow, readable, sliders functional
- Fail if: broken layout
```

**Pipeline-level rubric (end-to-end):**

```markdown
## Rubric for: Full pipeline integrity

### D1: End-to-end data trace
- Check method: deterministic
- Criterion: trace 5 values from Excel cell → JSON → Markdown → HTML
- Ground truth: the Excel source
- Pass if: all 5 match through every stage
- Fail if: any value changed at any stage

### D2: Sensitivity propagation
- Check method: deterministic
- Criterion: change an Excel input, re-run pipeline, HTML slider output reflects the change
- Ground truth: change input, re-run, compare
- Pass if: change propagates correctly
- Fail if: stale data at any stage
```

### Document generation rubric (Word, PDF, any format)

```markdown
## Rubric for: Document generation

### D1: Format compliance
- Check method: deterministic
- Criterion: output file opens correctly in the target application
- Ground truth: open the file, verify no corruption
- Pass if: opens without error, formatting intact
- Fail if: corrupt file, broken formatting, missing fonts

### D2: Content completeness
- Check method: structural
- Criterion: all sections from the brief/outline are present
- Ground truth: the brief or outline document
- Pass if: all sections present with substantive content
- Fail if: any section missing, placeholder text remaining

### D3: Factual accuracy
- Check method: source comparison
- Criterion: every claim, number, name, date traces to a stated source
- Ground truth: the source materials provided
- Pass if: spot-check of 5 claims all match sources
- Fail if: any claim doesn't match or has no source

### D4: No AI artifacts
- Check method: deterministic (grep/scan)
- Criterion: no placeholder markers, no "as an AI", no template language, no [TODO] markers
- Ground truth: regex scan for common artifacts
- Pass if: zero AI artifacts found
- Fail if: any placeholder or meta-language in final output

### D5: Tone/voice match
- Check method: model judgment (with examples)
- Criterion: document matches the target voice/tone
- Ground truth: 2-3 examples of approved writing in the same voice
- Pass if: evaluator confirms voice match against examples
- Fail if: tone mismatch (too formal, too casual, wrong register)
```

## The key principle

**The rubric determines what the loop optimizes toward.** A mediocre architecture with a specific, failure-mode-targeted rubric outperforms a sophisticated architecture with a vague rubric.

Every rubric dimension is a hypothesis: "this specific thing can go wrong." Every check method is a design choice: "this is how we catch it." Build rubrics from failure modes, not from vibes.

## References

- Wei et al. NeurIPS 2022 — "Chain-of-Thought Prompting Elicits Reasoning in Large Language Models"
- Shinn et al. NeurIPS 2023 — "Reflexion: Language Agents with Verbal Reinforcement Learning" (arXiv:2303.11366)
- Sharma et al. ICLR 2024 — "Towards Understanding Sycophancy in Language Models"
- Zhang & Press 2023 — Self-error detection: 67% in isolation, can't during generation
- Kadavath et al. 2022 — "Language Models (Mostly) Know What They Know" (arXiv:2207.05221)
- SCHEMA 2026 (arXiv:2605.02398) — Compliance ceiling: 8/11 models collapse 12-30pp
- Tam et al. EMNLP 2024 (arXiv:2408.02442) — Structured output degrades reasoning
- Turpin et al. 2023 (arXiv:2305.04388) — Unfaithful chain-of-thought
