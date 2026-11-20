import json,sys,glob
from collections import Counter,defaultdict
agg=defaultdict(lambda:[0,Counter()])
for f in sorted(glob.glob('sm-*.cpuprofile')):
    p=json.load(open(f)); nodes={n['id']:n for n in p['nodes']}; parent={}
    for n in p['nodes']:
        for ch in n.get('children',[]): parent[ch]=n['id']
    def nm(x):
        c=nodes[x]['callFrame']; return (c['functionName'] or '(anon)')+' '+c['url'].split('/')[-1]+':'+str(c['lineNumber'])
    st=[];cur=0;start=0
    for i,(s,d) in enumerate(zip(p['samples'],p['timeDeltas'])):
        fn=nodes[s]['callFrame']['functionName']
        if fn in('(idle)','(program)'):
            if cur>0: st.append((cur,start,i)); cur=0
        else:
            if cur==0: start=i
            cur+=d
    for c,a,b in st:
        if c<85000: continue
        cnt=Counter()
        for i in range(a,b):
            x=p['samples'][i]; d=p['timeDeltas'][i]; ch=set()
            while x is not None: ch.add(nm(x)); x=parent.get(x)
            for k in ch: cnt[k]+=d
        # key the stretch by its biggest app-level non-root frame
        keyfn=[k for k,_ in cnt.most_common(8) if not k.startswith('(root)') and 'dispatch' not in k.lower() and 'batchedUpdates' not in k][:1]
        key=keyfn[0] if keyfn else 'unknown'
        agg[key][0]+=1
        for k,v in cnt.most_common(14): agg[key][1][k]+=v
for key,(n,cnt) in sorted(agg.items(), key=lambda kv:-kv[1][0]):
    print(f'== {n} stretches >=85ms led by: {key}')
    for k,v in cnt.most_common(14): print('   ',round(v/n/1000,1),'ms',k)
