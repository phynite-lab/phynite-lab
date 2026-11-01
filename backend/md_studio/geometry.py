"""Integer-cell and Miller-plane transformations, matching browser geometry."""
from __future__ import annotations
import math
import numpy as np


def transform_frame(frame: dict, kind: str, params: dict) -> dict:
    cell=np.asarray(frame['vectors'],dtype=float)
    pbc=frame['periodic']
    if cell.shape != (3,3) or not np.all(np.isfinite(cell)) or abs(np.linalg.det(cell)) < 1e-10 or not frame.get('hasCell'):
        raise ValueError('Geometry requires a finite nonsingular source cell.')
    positions=np.asarray(frame['positions'],dtype=float).reshape((-1,3))
    fractional=(positions-np.asarray(frame['origin']))@np.linalg.inv(cell)
    for axis in range(3):
        if pbc[axis]: fractional[:,axis]%=1
    def integer_matrix(raw):
        m=np.asarray(raw,dtype=float).reshape((3,3))
        if not np.all(np.isfinite(m)) or np.any(m!=np.round(m)) or np.max(np.abs(m))>512: raise ValueError('Supercell needs a bounded integer 3×3 matrix.')
        determinant=round(np.linalg.det(m));size=abs(determinant)
        if determinant<=0 or size>4096 or len(positions)*size>100000: raise ValueError('Supercell exceeds 4096 cells or 100,000 atoms.')
        return m.astype(int),size
    if kind=='supercell':
        m,size=integer_matrix(params.get('matrix'))
        if not all(pbc) and np.any(m-np.diag(np.diag(m))): raise ValueError('Off-diagonal supercells require full periodicity.')
    elif kind=='surface_slab':
        raw=params.get('miller',[])
        if len(raw)!=3 or any(not isinstance(v,(float,int)) or not math.isfinite(v) or v!=int(v) or abs(v)>12 for v in raw) or not any(raw): raise ValueError('Use nonzero integer Miller indices between -12 and 12.')
        if not all(pbc): raise ValueError('Miller slabs require a fully periodic bulk source.')
        def egcd(a,b):
            if not b:return abs(a), (1 if a>0 else -1 if a<0 else 0),0
            quotient=math.trunc(a/b);g,x,y=egcd(b,a-quotient*b);return g,y,x-quotient*y
        h,k,l=(int(v)//math.gcd(*[int(v) for v in raw]) for v in raw)
        if not h and not k:m=np.array([[1,0,0],[0,l,0],[0,0,l]])
        else:
            g,x,y=egcd(h,k);_,a,b=egcd(g,l)
            m=np.array([[k//g,-h//g,0],[l*x,l*y,-g],[a*x,a*y,b]])
        m,size=integer_matrix(m)
    else:raise ValueError('Unsupported geometry operation.')
    inv=np.linalg.inv(m);det=round(np.linalg.det(m)); numerator=np.rint(inv*det).astype(int)
    def key(n):return tuple((np.array(n)@numerator)%size)
    translations=[(0,0,0)];seen={key(translations[0])}
    for n in translations:
        if len(translations)==size:break
        for axis in range(3):
            v=list(n);v[axis]+=1;identity=key(v)
            if identity not in seen:seen.add(identity);translations.append(tuple(v))
    if len(translations)!=size:raise ValueError('Incomplete supercell cosets.')
    f=np.concatenate([(fractional+n)@inv for n in translations]);
    for axis in range(3):
        if pbc[axis]: f[:,axis]%=1
    indices=list(range(len(positions)))*size
    newcell=m@cell
    identifiers=[f'{identifier}@cell:{image}' for image in range(size) for identifier in frame['ids']]
    provenance={'operation':kind,'matrix':m.tolist(),'sourceIndices':indices,'cellUnit':'angstrom','coordinateUnit':'fractional'}
    if kind=='surface_slab':
        layers=params.get('layers');vacuum=params.get('vacuumAngstrom');termination=params.get('termination',0)
        if not isinstance(layers,(float,int)) or layers!=int(layers) or not 1<=layers<=256 or not isinstance(vacuum,(float,int)) or not math.isfinite(vacuum) or not 0<vacuum<=1000:raise ValueError('Use 1–256 atomic layers and positive vacuum up to 1000 Å.')
        levels=sorted(set(np.round(f[:,2],8)))
        if not isinstance(termination,(float,int)) or termination!=int(termination) or not 0<=termination<len(levels):raise ValueError('Termination index does not name a distinct atomic plane.')
        termination=int(termination);layers=int(layers)
        a,b,c=newcell;normal=np.cross(a,b);normal*=np.sign(normal@c)/np.linalg.norm(normal);spacing=c@normal
        start=levels[termination]*spacing;last=termination+layers-1;thickness=(last//len(levels)+levels[last%len(levels)])*spacing-start
        resultcell=np.array([a,b,normal*(thickness+vacuum)])
        points=[];mapping=[];ids=[]
        for layer in range(layers):
            index=termination+layer;period=index//len(levels);level=levels[index%len(levels)]
            for i,pos in enumerate(f):
                if abs(pos[2]-level)>1e-7:continue
                points.append((pos+[0,0,period])@newcell+normal*(vacuum/2-start));mapping.append(indices[i]);ids.append(identifiers[i]+f'@layer:{layer}')
        if len(points)>100000:raise ValueError('Slab exceeds 100,000 atoms.')
        f=np.asarray(points)@np.linalg.inv(resultcell);f[:,:2]%=1;newcell=resultcell;indices=mapping;identifiers=ids;pbc=[True,True,False]
        provenance.update({'miller':raw,'layers':layers,'vacuumAngstrom':vacuum,'termination':termination,'sourceIndices':indices,'slabThicknessAngstrom':float(thickness)})
    return {**frame,'positions':(f@newcell).reshape(-1).tolist(),'vectors':newcell.tolist(),'origin':[0,0,0],'periodic':pbc,'ids':identifiers,'species':[frame['species'][i] for i in indices],'properties':{key:[values[i] for i in indices] for key,values in frame.get('properties',{}).items() if key not in {'ix','iy','iz','Periodic Image'}},'stringProperties':{key:[values[i] for i in indices] for key,values in frame.get('stringProperties',{}).items()},'coordinateMode':'wrapped','geometryProvenance':[*frame.get('geometryProvenance',[]),provenance]}
