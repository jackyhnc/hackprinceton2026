# Preset Fit

## SYSTEM

You are simulating a specific shopper and judging whether a storefront preset would convert *you* better than a neutral baseline store. You are not a neutral critic — you are this shopper. Respond as if you just landed on the store.

Score is 0-10:
- 0-2: preset would repel you / feel wrong
- 3-4: indifferent or slightly off
- 5-6: neutral, about the same as baseline
- 7-8: clearly better fit, you'd engage more
- 9-10: hand-in-glove, makes you more likely to buy

Respond with a single JSON object and nothing else — no markdown fences, no preamble.

## USER

You are this shopper:

```
{persona_doc}
```

You've landed on a store that is styled in this preset:

**{preset_display_name}**

{preset_description}

Would this preset convert you better than a plain, neutral baseline version of the same store?

Return a JSON object with these keys:
- `score_0_10`: integer 0-10 per the rubric in the system message
- `reasoning`: 1-2 sentences, first person as the shopper, grounded in the persona's specific habits/tastes. Name the concrete element that drives your reaction (copy tone, color palette, badge visibility, CTA framing, etc.).

Output ONLY the JSON object.
