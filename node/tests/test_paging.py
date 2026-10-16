from yt_digest_node.paging import MARKER, count_words, paginate, truncate


def _words(n: int, start: int = 0) -> str:
    return " ".join(f"w{i}" for i in range(start, start + n))


def test_truncate_keeps_first_and_last_words() -> None:
    paragraphs, truncated = truncate([_words(25)], 10)
    assert truncated
    assert paragraphs == [_words(5), MARKER, _words(5, 20)]
    assert count_words(paginate(paragraphs, 100)) == 10


def test_truncate_keeps_inner_paragraph_breaks() -> None:
    paragraphs, _ = truncate([_words(3), _words(10, 3), _words(3, 13)], 8)
    assert paragraphs == [_words(3), "w3", MARKER, "w12", _words(3, 13)]


def test_no_truncation_within_limit() -> None:
    assert truncate([_words(10)], 10) == ([_words(10)], False)


def test_pages_group_paragraphs_and_cut_long_ones() -> None:
    paragraphs = [_words(3), _words(2, 3), _words(2, 5), _words(12, 7), _words(1, 19)]
    pages = paginate(paragraphs, 5)
    assert pages == [
        f"{_words(3)}\n\n{_words(2, 3)}",
        _words(2, 5),
        _words(5, 7),
        _words(5, 12),
        _words(2, 17),
        _words(1, 19),
    ]
    assert all(0 < len(p.split()) <= 5 for p in pages)
    assert " ".join(pages).split() == " ".join(paragraphs).split()


def test_pages_join_back_without_cut() -> None:
    paragraphs = [_words(3), _words(4, 3), _words(2, 7)]
    assert "\n\n".join(paginate(paragraphs, 5)) == "\n\n".join(paragraphs)


def test_marker_is_not_a_word() -> None:
    pages = paginate([_words(5), MARKER, _words(5, 5)], 5)
    assert pages == [f"{_words(5)}\n\n{MARKER}", _words(5, 5)]
    assert count_words(pages) == 10
