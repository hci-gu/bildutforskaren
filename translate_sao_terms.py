"""Translate Swedish SAO image tags to English with a Hugging Face model.

The Swedish preferred label remains the canonical display value.  The generated
English label and prompt are intended for CLIP text embedding.

Example:
    uv run --extra cuda python translate_sao_terms.py --batch-size 16
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path

import pandas as pd
from tqdm.auto import tqdm


DEFAULT_MODEL = "Qwen/Qwen2.5-14B-Instruct"
DEFAULT_INPUT = Path(__file__).with_name("sao_terms.csv")
DEFAULT_OUTPUT = Path(__file__).with_name("sao_terms_english.csv")
ENGLISH_LABEL_COLUMN = "prefLabelEnglish"
EMBEDDING_PROMPT_COLUMN = "embeddingPromptEnglish"
TRANSLATION_MODEL_COLUMN = "translationModel"
TRANSLATION_PROMPT_VERSION_COLUMN = "translationPromptVersion"
TRANSLATION_PROMPT_VERSION = "sao_image_tag_translation_v1"
REQUIRED_COLUMNS = ("controlNumber", "prefLabel", "scopeNote")

SYSTEM_PROMPT = """\
You are a professional Swedish-to-English translator working with a controlled
vocabulary for historical image archives. The translated term will be used as
an image tag and embedded with CLIP.

Translate the Swedish preferred label into a concise, natural English noun
phrase. Use the Swedish scope note only to disambiguate the label; do not
translate or repeat the scope note. Preserve proper names, dates, and meaningful
qualifiers. Return only the English label, with no quotation marks, explanation,
prefix, or final full stop."""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Translate sao_terms.csv from Swedish to English in GPU batches. "
            "Existing translations are resumed by default."
        )
    )
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument(
        "--batch-size",
        type=int,
        default=16,
        help="Inference batch size; reduce this if GPU memory is exhausted.",
    )
    parser.add_argument(
        "--max-input-tokens",
        type=int,
        default=512,
        help="Maximum tokenized prompt length.",
    )
    parser.add_argument(
        "--max-new-tokens",
        type=int,
        default=48,
        help="Maximum number of tokens generated for each English label.",
    )
    parser.add_argument(
        "--checkpoint-every",
        type=int,
        default=10,
        help="Write an atomic checkpoint after this many batches.",
    )
    parser.add_argument(
        "--max-rows",
        type=int,
        help="Translate only the first N rows, useful for a quality-control run.",
    )
    parser.add_argument(
        "--resume",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Resume non-empty translations from an existing output file.",
    )
    return parser.parse_args()


def validate_args(args: argparse.Namespace) -> None:
    if args.batch_size < 1:
        raise ValueError("--batch-size must be at least 1")
    if args.max_input_tokens < 1:
        raise ValueError("--max-input-tokens must be at least 1")
    if args.max_new_tokens < 1:
        raise ValueError("--max-new-tokens must be at least 1")
    if args.checkpoint_every < 1:
        raise ValueError("--checkpoint-every must be at least 1")
    if args.max_rows is not None and args.max_rows < 1:
        raise ValueError("--max-rows must be at least 1")


def load_dataframe(
    input_path: Path,
    output_path: Path,
    resume: bool,
    model_name: str,
) -> pd.DataFrame:
    dataframe = pd.read_csv(input_path, dtype=str, keep_default_na=False)
    missing = [column for column in REQUIRED_COLUMNS if column not in dataframe.columns]
    if missing:
        raise ValueError(f"Missing required CSV columns: {', '.join(missing)}")
    if dataframe["controlNumber"].duplicated().any():
        raise ValueError("controlNumber values must be unique")
    if dataframe["prefLabel"].str.strip().eq("").any():
        raise ValueError("prefLabel values must not be empty")

    dataframe[ENGLISH_LABEL_COLUMN] = ""
    dataframe[EMBEDDING_PROMPT_COLUMN] = ""
    dataframe[TRANSLATION_MODEL_COLUMN] = ""
    dataframe[TRANSLATION_PROMPT_VERSION_COLUMN] = ""

    if not resume or not output_path.exists():
        return dataframe

    previous = pd.read_csv(output_path, dtype=str, keep_default_na=False)
    required_previous = {
        "controlNumber",
        ENGLISH_LABEL_COLUMN,
        TRANSLATION_MODEL_COLUMN,
        TRANSLATION_PROMPT_VERSION_COLUMN,
    }
    if not required_previous.issubset(previous.columns):
        raise ValueError(
            f"Cannot resume: {output_path} does not contain "
            f"{', '.join(sorted(required_previous))}"
        )
    if previous["controlNumber"].duplicated().any():
        raise ValueError(f"Cannot resume: duplicate controlNumber in {output_path}")

    completed = previous[ENGLISH_LABEL_COLUMN].str.strip().ne("")
    previous_models = set(
        previous.loc[completed, TRANSLATION_MODEL_COLUMN].str.strip()
    )
    previous_versions = set(
        previous.loc[completed, TRANSLATION_PROMPT_VERSION_COLUMN].str.strip()
    )
    if previous_models and previous_models != {model_name}:
        raise ValueError(
            f"Cannot resume translations created with {sorted(previous_models)} "
            f"using model {model_name!r}; use --no-resume or the original model."
        )
    if previous_versions and previous_versions != {TRANSLATION_PROMPT_VERSION}:
        raise ValueError(
            "Cannot resume translations created with a different translation "
            "prompt version; use --no-resume."
        )

    previous_by_id = previous.set_index("controlNumber")
    translations = previous_by_id[ENGLISH_LABEL_COLUMN]
    dataframe[ENGLISH_LABEL_COLUMN] = (
        dataframe["controlNumber"].map(translations).fillna("").str.strip()
    )
    dataframe[EMBEDDING_PROMPT_COLUMN] = dataframe[ENGLISH_LABEL_COLUMN].map(
        build_embedding_prompt
    )
    dataframe[TRANSLATION_MODEL_COLUMN] = (
        dataframe["controlNumber"]
        .map(previous_by_id[TRANSLATION_MODEL_COLUMN])
        .fillna("")
    )
    dataframe[TRANSLATION_PROMPT_VERSION_COLUMN] = (
        dataframe["controlNumber"]
        .map(previous_by_id[TRANSLATION_PROMPT_VERSION_COLUMN])
        .fillna("")
    )
    return dataframe


def build_user_prompt(label: str, scope_note: str) -> str:
    scope = scope_note.strip() or "(no scope note provided)"
    return (
        f"Swedish preferred label: {label.strip()}\n"
        f"Swedish scope note: {scope}\n"
        "English label:"
    )


def clean_translation(text: str) -> str:
    value = text.strip()
    value = re.sub(
        r"^(?:english (?:label|translation)|translation)\s*:\s*",
        "",
        value,
        flags=re.I,
    )
    value = value.splitlines()[0].strip() if value else ""
    value = value.strip("\"'` ")
    if value.endswith(".") and not value.endswith("..."):
        value = value[:-1].rstrip()
    return value


def build_embedding_prompt(label: str) -> str:
    label = label.strip()
    return f"A photograph depicting {label}." if label else ""


def save_checkpoint(dataframe: pd.DataFrame, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = output_path.with_suffix(f"{output_path.suffix}.tmp")
    dataframe.to_csv(temporary_path, index=False, encoding="utf-8")
    temporary_path.replace(output_path)


def load_model(model_name: str):
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    if not torch.cuda.is_available():
        raise RuntimeError(
            "CUDA is not available. This script is intended for GPU inference; "
            "install the CUDA project extra and verify the NVIDIA runtime."
        )

    tokenizer = AutoTokenizer.from_pretrained(model_name)
    tokenizer.padding_side = "left"
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token_id = tokenizer.eos_token_id

    model = AutoModelForCausalLM.from_pretrained(
        model_name,
        torch_dtype=torch.bfloat16,
        device_map="auto",
        low_cpu_mem_usage=True,
        attn_implementation="sdpa",
    )
    model.eval()
    return model, tokenizer


def translate_batch(
    labels: list[str],
    scope_notes: list[str],
    *,
    model,
    tokenizer,
    max_input_tokens: int,
    max_new_tokens: int,
) -> list[str]:
    import torch

    prompts = []
    for label, scope_note in zip(labels, scope_notes, strict=True):
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": build_user_prompt(label, scope_note)},
        ]
        prompts.append(
            tokenizer.apply_chat_template(
                messages,
                tokenize=False,
                add_generation_prompt=True,
            )
        )

    inputs = tokenizer(
        prompts,
        padding=True,
        truncation=True,
        max_length=max_input_tokens,
        return_tensors="pt",
    ).to(model.device)

    with torch.inference_mode():
        generated = model.generate(
            **inputs,
            do_sample=False,
            top_k=None,
            top_p=None,
            temperature=None,
            max_new_tokens=max_new_tokens,
            pad_token_id=tokenizer.pad_token_id,
            eos_token_id=tokenizer.eos_token_id,
        )

    input_length = inputs["input_ids"].shape[1]
    decoded = tokenizer.batch_decode(
        generated[:, input_length:],
        skip_special_tokens=True,
    )
    return [clean_translation(text) for text in decoded]


def main() -> None:
    args = parse_args()
    validate_args(args)
    dataframe = load_dataframe(args.input, args.output, args.resume, args.model)

    candidate_indices = dataframe.index[
        dataframe[ENGLISH_LABEL_COLUMN].str.strip().eq("")
    ].tolist()
    if args.max_rows is not None:
        candidate_indices = candidate_indices[: args.max_rows]

    if not candidate_indices:
        save_checkpoint(dataframe, args.output)
        print(f"Nothing to translate; output is complete: {args.output}")
        return

    print(f"Loading {args.model}")
    model, tokenizer = load_model(args.model)
    batch_starts = range(0, len(candidate_indices), args.batch_size)

    try:
        with tqdm(
            total=len(candidate_indices),
            desc="Translating SAO terms",
            unit="term",
        ) as progress:
            for batch_number, start in enumerate(batch_starts, start=1):
                indices = candidate_indices[start : start + args.batch_size]
                rows = dataframe.loc[indices]
                translations = translate_batch(
                    rows["prefLabel"].tolist(),
                    rows["scopeNote"].tolist(),
                    model=model,
                    tokenizer=tokenizer,
                    max_input_tokens=args.max_input_tokens,
                    max_new_tokens=args.max_new_tokens,
                )
                dataframe.loc[indices, ENGLISH_LABEL_COLUMN] = translations
                dataframe.loc[indices, EMBEDDING_PROMPT_COLUMN] = [
                    build_embedding_prompt(label) for label in translations
                ]
                dataframe.loc[indices, TRANSLATION_MODEL_COLUMN] = args.model
                dataframe.loc[
                    indices, TRANSLATION_PROMPT_VERSION_COLUMN
                ] = TRANSLATION_PROMPT_VERSION
                progress.update(len(indices))

                if batch_number % args.checkpoint_every == 0:
                    save_checkpoint(dataframe, args.output)
    except KeyboardInterrupt:
        print("\nInterrupted; saving completed translations before exiting.")
        save_checkpoint(dataframe, args.output)
        raise

    save_checkpoint(dataframe, args.output)
    translated_count = dataframe[ENGLISH_LABEL_COLUMN].str.strip().ne("").sum()
    print(f"Saved {translated_count:,} translated terms to {args.output}")


if __name__ == "__main__":
    main()
