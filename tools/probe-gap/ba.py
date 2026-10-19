# probe only: before / after coverage of the published data, per level and year
import json, sys
def load(p):
    c = json.load(open(p)); return c
B, A = load(sys.argv[1]), load(sys.argv[2])
for lv in ('ATP main draw', 'ATP qualifying', 'Challenger main draw', 'Challenger qualifying', 'ITF'):
    print('##', lv)
    for y in sorted(set(B['byLevel'].get(lv, {})) | set(A['byLevel'].get(lv, {}))):
        b, a = B['byLevel'].get(lv, {}).get(y, {}), A['byLevel'].get(lv, {}).get(y, {})
        print(f"  {y}: before {b.get('priced',0)}/{b.get('n',0)} after {a.get('priced',0)}/{a.get('n',0)}")
print('joinMiss', B.get('joinMiss'), '->', A.get('joinMiss'), 'roundDisagree', B.get('roundDisagree'), '->', A.get('roundDisagree'))
