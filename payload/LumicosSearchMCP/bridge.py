"""Lumicos Search v6 bridge: JSON lines over stdin/stdout for PersonalAI.

Same engine as server.py (search_core.py, MCP v6) without the MCP layer:
  -> {"id": "1", "tool": "research", "args": {"question": "...", "queries": ["..."], "max_pages": 4, "recent": ""}}
  <- {"id": "1", "ok": true, "text": "...", "sources": [...]}
Tools: research, web_search, fetch_page, ping. Several requests may run at once.
"""
import json
import os
import sys
import threading
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
for extra in (os.path.join(HERE, 'deps'), HERE):
    if extra not in sys.path:
        sys.path.insert(0, extra)

# Never flash a console window: any helper process a library starts (e.g. "cmd /c ver") runs hidden.
if os.name == 'nt':
    import subprocess as _sp
    _NO_WINDOW = getattr(_sp, 'CREATE_NO_WINDOW', 0x08000000)
    _PopenInit = _sp.Popen.__init__

    def _hidden_init(self, *args, **kwargs):
        kwargs['creationflags'] = kwargs.get('creationflags', 0) | _NO_WINDOW
        return _PopenInit(self, *args, **kwargs)
    _sp.Popen.__init__ = _hidden_init

OUT = sys.stdout
sys.stdout = sys.stderr  # anything the libraries print must not corrupt the protocol
LOCK = threading.Lock()

import search_core as core  # noqa: E402


def _has_thai(s):
    return any('฀' <= c <= '๿' for c in s or '')


def research(a):
    question = str(a.get('question') or '').strip()
    queries = [str(q) for q in (a.get('queries') or []) if str(q).strip()]
    if not question and not queries:
        raise ValueError('question is empty')
    res = core.research(question, queries or None, max_pages=int(a.get('max_pages') or 4),
                        timelimit=(a.get('recent') or None), region='auto')
    by_source = {}
    for p in res.get('passages', []):
        by_source.setdefault(p['source'], []).append(p['text'])
    sources = []
    for i, s in enumerate(res.get('sources', []), 1):
        text = ' … '.join(by_source.get(i, [])) or s.get('snippet') or ''
        sources.append({'n': i, 'title': s.get('title') or s.get('url'), 'url': s.get('url'), 'date': s.get('date') or None,
                        'read': bool(s.get('read')), 'lowRelevance': bool(s.get('low_relevance')), 'passage': text[:1500]})
    return {'ok': bool(sources), 'text': core.format_research(res), 'sources': sources,
            'lowRelevance': bool(res.get('all_low_relevance')), 'errors': res.get('errors', [])}


def web_search(a):
    q = str(a.get('query') or '').strip()
    if not q:
        raise ValueError('query is empty')
    rows = core.web_search(q, max_results=int(a.get('max_results') or 8), timelimit=(a.get('recent') or None),
                           region='th-th' if _has_thai(q) else 'us-en')
    return {'ok': bool(rows), 'text': core.format_search(rows, q),
            'sources': [{'n': i, 'title': r.get('title'), 'url': r.get('url'), 'passage': r.get('snippet', '')} for i, r in enumerate(rows, 1)]}


def fetch_page(a):
    p = core.fetch_page(str(a.get('url') or ''), max_chars=int(a.get('max_chars') or 6000))
    return {'ok': True, 'title': p.get('title'), 'url': p.get('url'), 'date': p.get('date'),
            'text': p.get('text', ''), 'truncated': bool(p.get('truncated'))}


TOOLS = {'research': research, 'web_search': web_search, 'fetch_page': fetch_page, 'ping': lambda a: {'ok': True, 'text': 'pong'}}


def reply(msg):
    line = json.dumps(msg, ensure_ascii=False)
    with LOCK:
        OUT.write(line + '\n')
        OUT.flush()


def handle(req):
    rid = req.get('id')
    try:
        fn = TOOLS.get(req.get('tool'))
        if not fn:
            raise ValueError(f"unknown tool {req.get('tool')!r}")
        reply({'id': rid, **fn(req.get('args') or {})})
    except Exception as e:  # report, never crash the bridge
        traceback.print_exc(file=sys.stderr)
        reply({'id': rid, 'ok': False, 'error': f'{type(e).__name__}: {e}'[:500]})


def main():
    reply({'id': None, 'ready': True, 'version': 'v6'})
    workers = []
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError:
            continue
        t = threading.Thread(target=handle, args=(req,), daemon=True)
        t.start()
        workers.append(t)
    for t in workers:  # stdin closed: finish what is still running, then exit
        t.join(timeout=60)


if __name__ == '__main__':
    main()
