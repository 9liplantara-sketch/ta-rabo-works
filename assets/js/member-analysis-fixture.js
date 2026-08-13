/**
 * Phase M1 — DEMO / FIXTURE data（チャート開発用）。
 * MEMBER select には使用しない。Phase M2 以降 MEMBER 正本は Neon students。
 * @deprecated member list generation — do not use for MEMBER select
 */
(function (global) {
  const FIXTURE_SOURCE = 'MEMBER_ANALYSIS_FIXTURE_DEMO';

  /** @type {Array<{id:string,memberId:string,memberName:string,assessedAt:string,source:string,scores:object}>} */
  const FIXTURE_ASSESSMENTS = [
    {
      id: 'demo-assessment-a-2026-01-15',
      memberId: 'demo-member-a',
      memberName: 'DEMO MEMBER A',
      assessedAt: '2026-01-15',
      source: FIXTURE_SOURCE,
      scores: {
        bigFive: {
          extraversion: 4.2,
          conscientiousness: 5.1,
          agreeableness: 4.6,
          emotionalStability: 3.8,
          openness: 5.9,
        },
        riasec: { R: 3.2, I: 4.5, A: 5.0, S: 2.4, E: 2.8, C: 1.9 },
        schwartz: {
          selfDirection: 5.0,
          stimulation: 4.3,
          hedonism: 3.5,
          achievement: 4.8,
          power: 2.2,
          security: 3.6,
          conformity: 2.5,
          tradition: 2.0,
          benevolence: 4.4,
          universalism: 4.9,
        },
        regulatoryFocus: { promotion: 5.3, prevention: 3.6 },
      },
    },
    {
      id: 'demo-assessment-a-2025-09-01',
      memberId: 'demo-member-a',
      memberName: 'DEMO MEMBER A',
      assessedAt: '2025-09-01',
      source: FIXTURE_SOURCE,
      scores: {
        bigFive: {
          extraversion: 3.7,
          conscientiousness: 4.8,
          agreeableness: 4.2,
          emotionalStability: 3.5,
          openness: 5.4,
        },
        riasec: { R: 2.9, I: 4.1, A: 4.6, S: 2.8, E: 2.5, C: 2.2 },
        schwartz: {
          selfDirection: 4.6,
          stimulation: 4.0,
          hedonism: 3.2,
          achievement: 4.4,
          power: 2.0,
          security: 3.9,
          conformity: 2.8,
          tradition: 2.3,
          benevolence: 4.1,
          universalism: 4.5,
        },
        regulatoryFocus: { promotion: 4.9, prevention: 4.0 },
      },
    },
    {
      id: 'demo-assessment-b-2026-02-20',
      memberId: 'demo-member-b',
      memberName: 'DEMO MEMBER B',
      assessedAt: '2026-02-20',
      source: FIXTURE_SOURCE,
      scores: {
        bigFive: {
          extraversion: 2.8,
          conscientiousness: 4.4,
          agreeableness: 5.2,
          emotionalStability: 4.6,
          openness: 4.1,
        },
        riasec: { R: 2.5, I: 5.0, A: 3.2, S: 3.8, E: 2.1, C: 4.0 },
        schwartz: {
          selfDirection: 4.2,
          stimulation: 3.0,
          hedonism: 2.8,
          achievement: 4.0,
          power: 2.5,
          security: 4.5,
          conformity: 3.9,
          tradition: 3.4,
          benevolence: 5.1,
          universalism: 4.3,
        },
        regulatoryFocus: { promotion: 3.8, prevention: 5.4 },
      },
    },
  ];

  global.MEMBER_ANALYSIS_FIXTURE_DEMO = Object.freeze({
    source: FIXTURE_SOURCE,
    assessments: Object.freeze(FIXTURE_ASSESSMENTS.map((a) => Object.freeze(a))),
  });
})(typeof window !== 'undefined' ? window : globalThis);
