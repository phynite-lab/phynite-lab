"""Public repository discovery. Only provider-derived, bounded HTTPS paths are read."""
from __future__ import annotations
import hashlib
import html
import io
import json
import lzma
import re
import tarfile
import urllib.parse
import urllib.request
from typing import Any
from backend.local_api.tls import verified_ssl_context

NIST='https://www.ctcms.nist.gov/potentials/'
KIM='https://query.openkim.org/api'
ELEMENTS=set('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og'.split())
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        # Permit only provider-local HTTPS redirects, never an arbitrary origin.
        validate_url(newurl)
        return super().redirect_request(req,fp,code,msg,headers,newurl)

def validate_url(url: str) -> None:
    p=urllib.parse.urlsplit(url)
    if p.scheme!='https' or p.hostname not in {'www.ctcms.nist.gov','query.openkim.org','openkim.org'} or p.port not in {None,443} or p.username or p.password or p.fragment or any(x in urllib.parse.unquote(p.path).split('/') for x in ('.','..')):
        raise ValueError('Repository URL is outside the provider allowlist.')
    if p.hostname=='www.ctcms.nist.gov' and not p.path.startswith('/potentials/'):raise ValueError('NIST URL is outside the potential repository.')
    if p.hostname=='openkim.org' and not p.path.startswith('/download/'):raise ValueError('OpenKIM downloads must use a versioned model package.')

def fetch(url: str, *, body: bytes | None=None, limit: int=2_000_000) -> bytes:
    validate_url(url)
    request=urllib.request.Request(url,data=body,headers={'User-Agent':'Phynite-Lab/1.0 (scientific potential catalog)','Accept-Encoding':'identity'})
    with urllib.request.build_opener(NoRedirect(), urllib.request.HTTPSHandler(context=verified_ssl_context())).open(request,timeout=12) as response:
        validate_url(response.url)
        if int(response.headers.get('Content-Length','0'))>limit:raise ValueError('Repository response exceeds its download limit.')
        raw=response.read(limit+1)
    if len(raw)>limit:raise ValueError('Repository response exceeds its download limit.')
    return raw

def clean(text: str) -> str:
    return re.sub(r'\s+',' ',html.unescape(re.sub(r'<[^>]*>',' ',text))).strip()

def checked_elements(elements: Any) -> list[str]:
    if not isinstance(elements,list) or not 1<=len(elements)<=32 or len(set(elements))!=len(elements) or any(e not in ELEMENTS for e in elements):raise ValueError('Map the structure to chemical elements before searching.')
    return elements

def nist_records(text: str, elements: list[str]) -> list[dict]:
    results=[]
    for card in re.split(r'<div class="card mb-4">',text)[1:]:
        entry=re.search(r'href="(?:\.\./)+entry/([A-Za-z0-9_-]+)"',card)
        if not entry:continue
        slug=entry.group(1);species=slug.split('--')[-1].split('-')
        if any(e not in ELEMENTS for e in species) or not set(elements).issubset(species):continue
        citation=re.search(r'<div class="citation">(.*?)</div>',card,re.S)
        for index, block in enumerate(re.split(r'<li class="list-group-item">',card)[2:]):
            style=re.search(r'LAMMPS pair_style\s+(eam/alloy|eam|meam|tersoff|sw)(?=\s|<|\()',block)
            if not style:continue
            family=style.group(1).replace('/','-')
            files=[]
            for href in re.findall(r'href="([^"]+)"',block):
                url=urllib.parse.urljoin(NIST+'entry/'+slug+'/',html.unescape(href));name=urllib.parse.unquote(urllib.parse.urlsplit(url).path.rsplit('/',1)[-1])
                if '/potentials/Download/' in url and re.fullmatch(r'[A-Za-z0-9_.-]+',name) and name.lower().endswith(('.eam','.alloy','.meam','.tersoff','.sw','.setfl','.funcfl')):
                    validate_url(url);files.append({'filename':name,'url':url})
            if not files:continue
            version=re.search(r'\(([A-Za-z0-9_-]+--LAMMPS--ipr\d+)\)',clean(block))
            notes=clean(block)[:1000]
            implementation=hashlib.sha256((family+'|'+ '|'.join(f['url'] for f in files)).encode()).hexdigest()[:20]
            results.append({'id':slug+':'+implementation,'provider':'nist','title':slug,'elements':species,'family':family,'year':slug[:4], 'citation':clean(citation.group(1))[:1000] if citation else NIST+'entry/'+slug, 'modelVersion':version.group(1) if version else slug+':implementation:'+implementation, 'sourceUrl':NIST+'entry/'+slug, 'license':'Not specified in record; review source usage notes', 'validityDomain':notes,'temperatureValidity':'Not specified; assess for the intended study','importable':len(files)==1 if family!='meam' else len(files)==2 and sum(bool(re.search(r'library|meam\.lib',f['filename'],re.I)) for f in files)==1,'reason':'MEAM requires the published library index order below' if family=='meam' else '', 'files':files})
    return results

def kim_query(query: dict, limit=30) -> list[dict]:
    fields={key:1 for key in ('kimcode','species','title','description','doi','publication-year','source-citations','model-driver','content-origin','potential-type')}
    body=urllib.parse.urlencode({'query':json.dumps(query),'fields':json.dumps(fields),'database':'obj','limit':str(limit),'sort':json.dumps([['kimcode',1]])}).encode()
    result=json.loads(fetch(KIM,body=body))
    if not isinstance(result,list):raise ValueError('OpenKIM did not return a model list.')
    return result

def kim_record(record: dict) -> dict:
    code=record['kimcode']
    if not re.fullmatch(r'[A-Za-z0-9_]+__(?:MO|SM)_\d{12}_\d{3}',code):raise ValueError('OpenKIM model has no pinned version.')
    citations=record.get('source-citations') or []
    citation='; '.join(f"{c.get('author','')} ({c.get('year','')}), {c.get('title','')}. DOI: {c.get('doi','')}" for c in citations)[:1000] or 'https://openkim.org/id/'+code
    supported=str(record.get('model-driver','')).startswith('EAM_Dynamo__MD_')
    return {'id':code,'provider':'openkim','title':record.get('title',code),'elements':record.get('species',[]),'family':record.get('potential-type','KIM model'),'year':record.get('publication-year'),'citation':citation,'modelVersion':code,'sourceUrl':'https://openkim.org/id/'+code,'license':'Read from versioned package during import','validityDomain':record.get('description','See model documentation')[:1000],'temperatureValidity':'Not specified; consult model tests and study conditions','importable':supported,'reason':'' if supported else 'Requires KIM model driver or an unsupported simulator format; use the source instructions','files':[]}

def search(provider: str, elements: list[str], query: str='') -> list[dict]:
    checked_elements(elements)
    if provider=='nist':
        # NIST system pages include supersets; filter each actual record by species.
        text=fetch(NIST+'system/'+'-'.join(sorted(elements)),limit=6_000_000).decode('utf-8')
        rows=nist_records(text,elements)
    elif provider=='openkim':
        criteria={'type':{'$in':['mo','sm']},'species':{'$all':elements},'latest':True,'approved':True}
        if query.strip(): criteria['$and']=[{'$or':[{'title':{'$regex':re.escape(term),'$options':'i'}},{'kimcode':{'$regex':re.escape(term),'$options':'i'}}]} for term in query.split()[:10]]
        rows=[kim_record(r) for r in kim_query(criteria,60)]
    else:raise ValueError('Choose NIST or OpenKIM.')
    terms=query.lower().split()
    return [{k:v for k,v in r.items() if k!='files'} for r in rows if all(t in (r['title']+' '+r['citation']+' '+r['family']).lower() for t in terms)][:60]

def ingest_files(provider: str, identifier: str, elements: list[str], library_element_order: list[str] | None = None) -> tuple[dict,list[tuple[str,bytes]],dict]:
    checked_elements(elements)
    if provider=='nist':
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,250}:[a-f0-9]{20}',identifier):raise ValueError('Invalid NIST implementation identifier.')
        slug=identifier.split(':')[0]
        rows=nist_records('<div class="card mb-4">'+fetch(NIST+'entry/'+slug+'/').decode(),elements)
        record=next((r for r in rows if r['id']==identifier),None)
        if not record or not record['importable']:raise ValueError('This NIST implementation needs manual mapping or is no longer available.')
        if record['family']=='meam':
            if not isinstance(library_element_order,list) or len(library_element_order)!=len(record['elements']) or len(set(library_element_order))!=len(library_element_order) or set(library_element_order)!=set(record['elements']): raise ValueError('Enter every model element once in the published MEAM parameter index order.')
            record['libraryElementOrder']=library_element_order
        files=[(f['filename'],fetch(f['url'],limit=20*1024*1024)) for f in record['files']]
        provenance={'sourceUrl':record['sourceUrl'],'provider':'nist','modelVersion':record['modelVersion'],'retrievedFiles':record['files']}
    elif provider=='openkim':
        if not re.fullmatch(r'[A-Za-z0-9_]+__(?:MO|SM)_\d{12}_\d{3}',identifier):raise ValueError('Use a complete versioned OpenKIM identifier.')
        matches=kim_query({'kimcode':identifier},1)
        if len(matches)!=1:raise ValueError('OpenKIM model is unavailable.')
        record=kim_record(matches[0])
        if not record['importable']:raise ValueError(record['reason'])
        raw=fetch('https://openkim.org/download/'+identifier+'.txz',limit=20*1024*1024)
        files=[];licenses=[];published={};total=0
        decoder=lzma.LZMADecompressor(memlimit=128*1024*1024)
        unpacked=decoder.decompress(raw,max_length=51*1024*1024)
        if not decoder.eof or len(unpacked)>50*1024*1024: raise ValueError('Unpacked model exceeds its memory or size limit.')
        with tarfile.open(fileobj=io.BytesIO(unpacked),mode='r:') as archive:
            for member_index, member in enumerate(archive):
                if member_index>=256: raise ValueError('Model package contains too many files.')
                if not member.isfile():
                    if member.isdir():continue
                    raise ValueError('Model packages may not contain links or special files.')
                parts=member.name.split('/')
                if len(parts)!=2 or parts[0]!=identifier or not re.fullmatch(r'[A-Za-z0-9_.-]+',parts[-1]) or member.size>20*1024*1024:raise ValueError('Model package has an unsupported member.')
                total+=member.size
                if total>50*1024*1024:raise ValueError('Unpacked model exceeds 50 MiB.')
                name=parts[-1]
                if name.lower().endswith(('.eam.alloy','.eam','.setfl','.funcfl')):
                    files.append((name,archive.extractfile(member).read()))
                elif name.startswith(('LICENSE','COPYING')):licenses.append(archive.extractfile(member).read(100000).decode('utf-8'))
                elif name=='kimprovenance.edn':
                    text=archive.extractfile(member).read(1000000).decode();published=dict(re.findall(r'"([^"/]+)"\s+"([a-f0-9]{40})"',text.split('"comments"')[0]))
        if sum(len(t) for t in licenses)>100000: raise ValueError('License texts exceed the retained metadata limit; use a manually documented upload.')
        if len(files)!=1 or not licenses or files[0][0] not in published or hashlib.sha1(files[0][1]).hexdigest()!=published[files[0][0]]:raise ValueError('Model needs one verified compatible table, its published checksum, and explicit license text.')
        name,content=files[0];lines=content.decode('utf-8').splitlines()
        header=lines[3].split() if len(lines)>3 else []
        if header and header[0].isdigit() and int(header[0])==len(header)-1 and set(header[1:])==set(record['elements']):record['family']='eam-alloy'
        elif len(record['elements'])==1 and len(lines)>2 and lines[1].split()[0].isdigit():record['family']='eam'
        else:raise ValueError('EAM table format or element order cannot be verified; choose a supported setfl/funcfl file.')
        record['license']='Versioned OpenKIM package license; retained with source provenance'
        provenance={'provider':'openkim','sourceUrl':record['sourceUrl'],'modelVersion':identifier,'packageSha256':hashlib.sha256(raw).hexdigest(),'publishedSha1':published[name],'licenseText':'\n\n'.join(licenses),'runtimeInterpretation':'LAMMPS eam family with the checksum-verified original table; KIM model driver is not executed'}
    else:raise ValueError('Choose NIST or OpenKIM.')
    if not set(elements).issubset(record['elements']) or not files or any(not data for _,data in files):raise ValueError('Potential does not cover the mapped structure elements.')
    for _,raw in files:
        unit=re.search(rb'UNITS:\s*([A-Za-z]+)',raw[:4096],re.I)
        if unit and unit.group(1).lower()!=b'metal': raise ValueError('This potential uses units other than the supported metal convention.')
    provenance['files']=[{'filename':name,'sha256':hashlib.sha256(data).hexdigest(),'sizeBytes':len(data)} for name,data in files]
    return record,files,provenance
