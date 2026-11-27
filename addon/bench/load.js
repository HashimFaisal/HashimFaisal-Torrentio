import http from 'k6/http';
import exec from 'k6/execution';
import { check } from 'k6';
import { SharedArray } from 'k6/data';

const targets = new SharedArray('targets', () =>
  open(__ENV.TARGETS).split(/\r?\n/).map(line => line.trim()).filter(Boolean),
);
const mode = __ENV.MODE;
const vus = Number(__ENV.VUS || 64);

if (!__ENV.BASE || !__ENV.TARGETS) {
  throw new Error('BASE and TARGETS are required');
}
if (!targets.length) {
  throw new Error('TARGETS must contain at least one "<type> <id>" line');
}
if (mode !== 'hot' && mode !== 'cold') {
  throw new Error('MODE must be either "hot" or "cold"');
}

export const options = {
  discardResponseBodies: true,
  summaryTrendStats: ['min', 'med', 'avg', 'p(90)', 'p(95)', 'p(99)', 'max'],
  scenarios: {
    run: mode === 'hot'
      ? { executor: 'constant-vus', vus, duration: __ENV.DURATION || '20s' }
      : { executor: 'shared-iterations', vus, iterations: targets.length, maxDuration: '300s' },
  },
};

export default function () {
  const iteration = exec.scenario.iterationInTest;
  const index = mode === 'hot' ? iteration % targets.length : iteration;
  const [type, id] = targets[index].split(/\s+/, 2);
  const client = iteration + 1;
  const ip = `10.${Math.floor(client / 65536) % 256}.${Math.floor(client / 256) % 256}.${client % 256}`;
  const config = __ENV.CONFIG ? `${encodeURIComponent(__ENV.CONFIG)}/` : '';
  const res = http.get(`${__ENV.BASE}/${config}stream/${type}/${encodeURIComponent(id)}.json`, { headers: { 'x-forwarded-for': ip } });
  check(res, { ok: r => r.status === 200 });
}
