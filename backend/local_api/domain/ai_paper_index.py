"""Non-executing, bounded PDF text indexing. Layout/figures are never inferred."""
from __future__ import annotations
import re
from backend.local_api.domain.ai_workspace import fail

HEADING = re.compile(r'^(?:(?:\d+(?:\.\d+){0,3})[.)]?\s+.{2,140}|abstract|introduction|(?:computational|experimental)\s+(?:details|methods)|methods|methodology|results(?:\s+and\s+discussion)?|discussion|conclusions?|references|bibliography|appendix(?:\s+.{0,80})?)$', re.I)
CAPTION = re.compile(r'^((?:fig(?:ure)?\.?|table|scheme)\s+[A-Z]?\d+[A-Za-z]?)\s*[:.\-–]?\s+(.{4,1000})$', re.I)


def pdf_index(pdf, sections, pages):
    toc, captions, references = [], [], []
    seen = set()

    def heading(title, page, level=1, origin='text_heuristic'):
        title = title.strip()[:200]
        key = (title.casefold(), page)
        if key in seen or not title or len(toc) >= 500:
            return
        seen.add(key)
        toc.append({'sectionId': f'section_{len(toc) + 1}', 'title': title, 'level': min(level, 8), 'pageStart': page, 'origin': origin})

    def outline(items, level=1):
        if level > 8: return
        for item in items[:500]:
            if isinstance(item, list): outline(item, level + 1)
            else:
                try:
                    page = pdf.get_destination_page_number(item) + 1
                    if 1 <= page <= len(pages): heading(str(item.title), page, level, 'pdf_outline')
                except (ValueError, TypeError, AttributeError): pass
    try: outline(pdf.outline)
    except (ValueError, TypeError, AttributeError): pass
    bibliography = False
    for page in pages:
        for line in page['text'].splitlines():
            line = line.strip()
            if len(line) <= 150 and HEADING.fullmatch(line):
                heading(line, page['page'])
                if re.fullmatch(r'(?:\d+[.)]?\s+)?(?:references|bibliography)', line, re.I): bibliography = True
            caption = CAPTION.fullmatch(line)
            if caption and len(captions) < 500:
                captions.append({'label': caption[1], 'page': page['page'], 'sectionIndex': page['sectionIndices'][0] if page['sectionIndices'] else None, 'text': line})
            if bibliography and line and not HEADING.fullmatch(line) and len(references) < 1000:
                references.append({'text': line[:1500], 'page': page['page'],
                                   'dois': re.findall(r'10\.\d{4,9}/[^\s<>]+', line)[:10],
                                   'arxivIds': re.findall(r'(?:arXiv:)?(\d{4}\.\d{4,5}(?:v\d+)?)', line)[:10],
                                   'years': re.findall(r'\b(?:19|20)\d{2}\b', line)[:10]})
    toc.sort(key=lambda item: (item['pageStart'], item['level']))
    for i, item in enumerate(toc):
        following = next((row['pageStart'] for row in toc[i + 1:] if row['pageStart'] > item['pageStart'] and row['level'] <= item['level']), len(pages) + 1)
        item['pageEnd'] = max(item['pageStart'], following - 1)
        indices = [j for j, section in enumerate(sections) if item['pageStart'] <= section.get('page', 0) <= item['pageEnd']]
        item['sectionStartIndex'] = min(indices) if indices else 0
        item['sectionEndIndex'] = max(indices) if indices else 0
    return {'toc': toc, 'pagesIndex': [{k: v for k, v in page.items() if k != 'text'} for page in pages],
            'captions': captions, 'references': references, 'indexLimits': 'Outline and text heuristics only; captions/references may be incomplete. Figures, tables as images, layout and scanned pages require separate visual evidence.'}


def selected_indices(document, payload):
    start, end = payload.get('pageStart', 1), payload.get('pageEnd', document.get('pages', 150))
    if type(start) is not int or type(end) is not int or not 1 <= start <= end <= 150:
        fail(400, 'Choose an ordered page range between 1 and 150.', 'AI_ATTACHMENT_INVALID')
    section = payload.get('section')
    if section is not None:
        if not isinstance(section, str): fail(400, 'Use a returned sectionId.', 'AI_ATTACHMENT_INVALID')
        entry = next((row for row in document.get('toc', []) if row['sectionId'] == section), None)
        if not entry: fail(404, 'This section is not in the attachment index.', 'AI_ATTACHMENT_SECTION_NOT_FOUND')
        start, end = max(start, entry['pageStart']), min(end, entry['pageEnd'])
    return [i for i, row in enumerate(document['sections']) if 'page' not in row or start <= row['page'] <= end]


def search_document(document, payload):
    query, maximum = payload.get('query'), payload.get('maxHits', 10)
    if not isinstance(query, str) or not 1 <= len(query.strip()) <= 200 or type(maximum) is not int or not 1 <= maximum <= 20:
        fail(400, 'Search 1–200 characters and request 1–20 hits.', 'AI_ATTACHMENT_INVALID')
    words = query.casefold().split()
    hits, total = [], 0
    for index in selected_indices(document, payload):
        row = document['sections'][index]
        lower = row['text'].casefold()
        if not all(word in lower for word in words): continue
        total += 1
        if len(hits) >= maximum: continue
        at = min(lower.find(word) for word in words)
        hits.append({'sectionIndex': index, 'page': row.get('page'), 'reference': row['reference'],
                     'sectionIds': [section['sectionId'] for section in document.get('toc', []) if section['sectionStartIndex'] <= index <= section['sectionEndIndex']],
                     'snippet': row['text'][max(0, at - 200):at + 400]})
    return {'hits': hits, 'totalMatches': total, 'truncated': total > len(hits),
            'captions': [row for row in document.get('captions', []) if all(word in row['text'].casefold() for word in words)][:maximum],
            'readingLimit': 'Search snippets only, not a full paper or visual reading.'}
