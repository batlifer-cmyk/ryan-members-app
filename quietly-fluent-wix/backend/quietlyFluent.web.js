import wixData from 'wix-data';
import { currentMember } from 'wix-members-backend';
import { Permissions, webMethod } from 'wix-web-module';

const STUDENTS = 'QuietlyFluentStudents';
const LESSON_LOGS = 'QuietlyFluentLessonLogs';
const APP_VERSION = '2026.07-wix-v1';
const MAX_STATE_BYTES = 420000;
const STAFF_ROLE_PATTERN = /(admin|teacher|instructor|강사|운영|원장|대표)/i;

function plainJson(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function memberName(member) {
  const contact = member?.contactDetails || member?.contact || {};
  const firstName = contact.firstName || '';
  const lastName = contact.lastName || '';
  return member?.profile?.nickname
    || [firstName, lastName].filter(Boolean).join(' ')
    || String(member?.loginEmail || '').split('@')[0]
    || '학습자';
}

async function requireMember() {
  try {
    const member = await currentMember.getMember();
    if (!member?._id) throw new Error('MEMBER_REQUIRED');
    return member;
  } catch (error) {
    throw new Error('라이언멤버스 회원 로그인이 필요합니다.');
  }
}

async function staffStatus() {
  try {
    const roles = await currentMember.getRoles();
    return roles.some((role) => STAFF_ROLE_PATTERN.test(role?.title || role?.name || ''));
  } catch (error) {
    return false;
  }
}

function sanitizeState(input) {
  const state = plainJson(input);
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new Error('학습 기록 형식이 올바르지 않습니다.');
  }
  const serialized = JSON.stringify(state);
  if (serialized.length > MAX_STATE_BYTES) {
    throw new Error('학습 기록의 저장 용량을 초과했습니다.');
  }
  state.completed = Array.isArray(state.completed)
    ? [...new Set(state.completed.map(Number).filter((n) => n >= 1 && n <= 16))].sort((a, b) => a - b)
    : [];
  state.lesson = state.lesson && typeof state.lesson === 'object' && !Array.isArray(state.lesson)
    ? state.lesson
    : {};
  state.updatedAt = new Date().toISOString();
  return state;
}

function numericAverage(state, key) {
  const values = Object.values(state.lesson || {})
    .map((lesson) => Number(lesson?.[key]))
    .filter(Number.isFinite);
  return values.length
    ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10
    : 0;
}

function currentUnit(state) {
  for (let unitId = 1; unitId <= 16; unitId += 1) {
    if (!state.completed.includes(unitId)) return unitId;
  }
  return 16;
}

async function findStudent(memberId) {
  const result = await wixData.query(STUDENTS)
    .eq('memberId', memberId)
    .limit(1)
    .find({ suppressAuth: true, consistentRead: true });
  return result.items[0] || null;
}

async function upsertLessonLog({ member, student, state, unitId }) {
  const id = Number(unitId);
  if (!Number.isInteger(id) || id < 1 || id > 16) return null;

  const lesson = state.lesson?.[id] || state.lesson?.[String(id)];
  if (!lesson || typeof lesson !== 'object') return null;

  const existing = await wixData.query(LESSON_LOGS)
    .eq('memberId', member._id)
    .eq('unitId', id)
    .limit(1)
    .find({ suppressAuth: true, consistentRead: true });

  const teacher = lesson.teacher || {};
  const item = {
    ...(existing.items[0] || {}),
    memberId: member._id,
    studentId: student?._id || '',
    studentName: student?.studentName || memberName(member),
    unitId: id,
    unitTitle: String(lesson.unitTitle || ''),
    completed: state.completed.includes(id),
    energy: Number(lesson.energy) || 0,
    wtc: Number(lesson.wtc) || 0,
    anxiety: Number(lesson.anxiety) || 0,
    fatigue: Number(lesson.fatigue) || 0,
    successUtterance: String(lesson.success || ''),
    goodBehavior: String(lesson.good || ''),
    nextBurden: String(lesson.burden || ''),
    meaningFeedback: String(teacher.meaning || ''),
    focusFeedback: String(teacher.focus || ''),
    retryFeedback: String(teacher.retry || ''),
    notes: String(lesson.notes || ''),
    updatedAt: new Date(),
  };
  return wixData.save(LESSON_LOGS, item, { suppressAuth: true });
}

export const loadQuietlyFluentState = webMethod(Permissions.SiteMember, async () => {
  const member = await requireMember();
  const [student, isStaff] = await Promise.all([
    findStudent(member._id),
    staffStatus(),
  ]);

  return {
    ok: true,
    member: {
      id: member._id,
      name: student?.studentName || memberName(member),
    },
    isStaff,
    state: student?.stateJson || null,
    savedAt: student?._updatedDate || null,
    appVersion: APP_VERSION,
  };
});

export const saveQuietlyFluentState = webMethod(Permissions.SiteMember, async (payload = {}) => {
  const member = await requireMember();
  const state = sanitizeState(payload.state);
  const existing = await findStudent(member._id);
  const displayName = existing?.studentName || memberName(member);

  const item = {
    ...(existing || {}),
    memberId: member._id,
    studentName: displayName,
    phone: existing?.phone || '',
    teacherName: existing?.teacherName || '',
    courseStatus: existing?.courseStatus || 'ACTIVE',
    currentUnit: currentUnit(state),
    completedCount: state.completed.length,
    wtcAverage: numericAverage(state, 'wtc'),
    anxietyAverage: numericAverage(state, 'anxiety'),
    lastActivityAt: new Date(),
    stateJson: state,
    appVersion: String(payload.appVersion || APP_VERSION),
  };

  const savedStudent = await wixData.save(STUDENTS, item, { suppressAuth: true });
  await upsertLessonLog({ member, student: savedStudent, state, unitId: payload.unitId });

  return {
    ok: true,
    studentId: savedStudent._id,
    savedAt: savedStudent._updatedDate || new Date(),
    completedCount: state.completed.length,
    currentUnit: item.currentUnit,
  };
});
