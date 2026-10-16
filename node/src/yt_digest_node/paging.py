"""Truncation and pages (spec sections 5.5 and 5.6)."""

MARKER = "[…]"


def _take(paragraphs: list[list[str]], count: int) -> list[list[str]]:
    """The first `count` words, keeping the paragraph breaks inside them."""
    taken: list[list[str]] = []
    for words in paragraphs:
        if count <= 0:
            break
        taken.append(words[:count])
        count -= len(words)
    return taken


def truncate(paragraphs: list[str], max_words: int) -> tuple[list[str], bool]:
    """Keep the first and last `max_words // 2` words around a `[…]` paragraph."""
    split = [p.split() for p in paragraphs]
    if sum(len(words) for words in split) <= max_words:
        return paragraphs, False
    half = max_words // 2
    head = _take(split, half)
    tail = [
        words[::-1]
        for words in reversed(_take([w[::-1] for w in reversed(split)], half))
    ]
    return [" ".join(w) for w in head] + [MARKER] + [" ".join(w) for w in tail], True


def paginate(paragraphs: list[str], page_words: int) -> list[str]:
    """Group whole paragraphs into pages of at most `page_words`; cut longer ones."""
    pages: list[str] = []
    current: list[str] = []
    size = 0
    for paragraph in paragraphs:
        words = paragraph.split()
        count = 0 if paragraph == MARKER else len(words)
        if count > page_words:
            if current:
                pages.append("\n\n".join(current))
                current, size = [], 0
            for i in range(0, len(words), page_words):
                pages.append(" ".join(words[i : i + page_words]))
            continue
        if current and size + count > page_words:
            pages.append("\n\n".join(current))
            current, size = [], 0
        current.append(paragraph)
        size += count
    if current:
        pages.append("\n\n".join(current))
    return pages


def count_words(pages: list[str]) -> int:
    """Words of all pages together, the `[…]` marker excluded."""
    return sum(
        len(p.split()) for page in pages for p in page.split("\n\n") if p != MARKER
    )
