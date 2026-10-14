// 多校区（南海 / 石牌）工具。
// 老板账号 campus = null（后端登录返回），可在顶栏切换查看任一校区；
// 普通客服/运营账号后端已强制锁死自己的 campus，前端不显示切换器，请求里的 campus 参数也会被后端忽略。

export const CAMPUSES = Object.freeze(['nanhai', 'shipai', 'gqg'])
export const CAMPUS_LABEL = Object.freeze({ nanhai: '华师南海', shipai: '华师石牌', gqg: '广轻工南海北区' })

let selectedCampus = CAMPUSES[0]

// 老板 = campus 为 null/空（后端把老板 backfill 成 campus=NULL）。
export function isBoss(admin) {
  return Boolean(admin && !admin.campus)
}

export function selectCampus(campus) {
  if (CAMPUSES.includes(campus)) selectedCampus = campus
}

// 客服/运营返回自己的 campus；老板返回当前选中校区（默认南海，与后端 resolveAdminCampus 默认一致）。
export function effectiveCampus(admin) {
  const c = admin && admin.campus
  if (CAMPUSES.includes(c)) return c
  return CAMPUSES.includes(selectedCampus) ? selectedCampus : CAMPUSES[0]
}

export function campusLabel(campus) {
  return CAMPUS_LABEL[campus] || campus || '—'
}
