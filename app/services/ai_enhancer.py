import json

from openai import OpenAI


client = OpenAI()


def enhance_life_history_data(species_title: str, stages: list[dict]):
    compact = {
        "title": species_title,
        "stages": [
            {"title": s.get("title", ""), "bullets": s.get("bullets", [])}
            for s in stages
        ],
    }

    system_prompt = (
        "You are an ecologist who designs clear life-history diagrams.\n"
        "TASK:\n"
        "- Reorder stages into a logical life-history sequence.\n"
        "- Merge near-duplicate stages when appropriate.\n"
        "- Preserve clear 'Duration:' bullets when present.\n"
        "- Preserve clear 'Timing:' / seasonal timing bullets when present.\n"
        "- Preserve one clear 'Lifespan:' value when present anywhere in the input.\n"
        "- For each stage, keep at most 5 concise bullets summarizing the information\n"
        "  (habitat, movement, food, reproduction, lifespan, etc.).\n"
        "- Do NOT invent any new biological facts; only rephrase or combine what is given.\n\n"
        "OUTPUT FORMAT (IMPORTANT):\n"
        "- Return ONLY valid JSON.\n"
        "- No explanation, no commentary, no markdown, no ``` fences.\n"
        "- Shape must be: {\"title\": string, \"stages\": [{\"title\": string, \"bullets\": [string, ...]}, ...]}\n"
    )

    user_prompt = (
        "Here is the current life-history data as JSON. "
        "Reorder and clean it as described, and return ONLY the JSON object.\n\n"
        f"{json.dumps(compact, ensure_ascii=False)}"
    )

    resp = client.responses.create(
        model="gpt-4.1-mini",
        input=[
            {"role": "system", "content": [{"type": "input_text", "text": system_prompt}]},
            {"role": "user", "content": [{"type": "input_text", "text": user_prompt}]},
        ],
    )

    text_out = resp.output[0].content[0].text.strip()

    if text_out.startswith("```"):
        lines = text_out.splitlines()
        lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        text_out = "\n".join(lines).strip()

    return json.loads(text_out)
