"""Independent development check, not required to generate fixtures.
Feed one JSON object per line: {"schema":..., "suite":...}. Never resolves refs.
Requires an existing Python jsonschema 4.x; the product itself has zero packages.
"""
import json, sys
from jsonschema import Draft202012Validator

def ptr(parts):
    return ''.join('/' + str(k).replace('~','~0').replace('/','~1') for k in parts)

def check(schema, suite):
    # Our generator rejects references. Don't evaluate references supplied on this input.
    def no_refs(node):
        if isinstance(node, dict):
            if set(node) & {'$ref','$dynamicRef','$recursiveRef'}: raise ValueError('references forbidden')
            # Only the supported object fields contain nested schemas; reject all
            # other schema-bearing keywords, so no indirect references are run.
            allowed={'type','properties','required','additionalProperties','enum','minLength','maxLength','minimum','maximum','$schema'}
            if set(node)-allowed: raise ValueError('unsupported keyword in oracle input')
            if not isinstance(node.get('additionalProperties', True), bool): raise ValueError('object-valued additionalProperties forbidden')
            for val in node.get('properties', {}).values():
                if isinstance(val, dict) and '$schema' in val: raise ValueError('nested dialect forbidden')
                no_refs(val)
        else:
            raise ValueError('schema must be an object')
    no_refs(schema)
    if schema.get('$schema','https://json-schema.org/draft/2020-12/schema') != 'https://json-schema.org/draft/2020-12/schema':
        raise ValueError('unsupported root dialect')
    Draft202012Validator.check_schema(schema)
    validator = Draft202012Validator(schema)
    rows=suite['cases']; baseline=rows[0]['payload']
    assert rows[0]['id']=='baseline:' and rows[0]['expected']=='accept'
    assert len(set(row['id'] for row in rows))==len(rows)
    accepts=sum(row['expected']=='accept' for row in rows)
    assert suite['counts']=={'total':len(rows),'accept':accepts,'reject':len(rows)-accepts}
    def differences(a,b,p=()):
        if type(a) is not type(b): return [ptr(p)]
        if not isinstance(a,dict): return [] if a==b else [ptr(p)]
        out=[]
        for k in set(a)|set(b):
            q=(*p,k)
            if k not in a or k not in b: out.append(ptr(q))
            else: out.extend(differences(a[k],b[k],q))
        return out
    for case in rows:
        errors = []
        for e in validator.iter_errors(case['payload']):
            path = list(e.absolute_path)
            if e.validator == 'required':
                missing = [x for x in e.validator_value if x not in e.instance]
                assert len(missing)==1, (case['id'],missing)
                path += missing
            if e.validator == 'additionalProperties':
                extra = [x for x in e.instance if x not in e.schema['properties']]
                assert len(extra)==1, (case['id'],extra)
                path += extra
            errors.append({'pointer':ptr(path),'rule':e.validator})
        if case['expected']=='reject':
            assert errors==[{'pointer':case['field'],'rule':case['rule']}],case['id']
            assert differences(baseline,case['payload'])==[case['field']],case['id']
        assert errors==case['expectedErrors'], (case['id'], errors,case['expectedErrors'])
        assert (not errors)==(case['expected']=='accept'),case['id']
    return len(suite['cases'])

if __name__=='__main__':
    if not __debug__: raise SystemExit('Checks require normal Python (no -O).')
    suites=cases=0
    for line in sys.stdin:
        item=json.loads(line);cases+=check(item['schema'],item['suite']);suites+=1
    if not suites: raise SystemExit('No suites supplied')
    print(f'{suites} suites / {cases} cases agree with independent Draft 2020-12 validation')
