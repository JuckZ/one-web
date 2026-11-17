import type { RepoLensResult, Repository } from './contracts'

const stopwords = new Set('the and for with from that this into your you are was were is it as at be by of on or to we our have has not but can will all any use using used based open source project github software application app tool tools simple fast modern powerful easy more about also only other 一个 用于 以及 可以 项目 工具 开源 基于 使用 提供 实现'.split(' '))
function tokenize(text: string) {
  return (text.toLowerCase().replace(/https?:\/\/\S+/g, ' ').match(/[a-z][a-z0-9+.#_-]+|[\u4E00-\u9FFF]{2,}/g) ?? [])
    .filter(word => !stopwords.has(word))
}

export function buildQueries(repo: Repository, readme: string) {
  const base = 'archived:false fork:false stars:>5'
  const domainTerms = new Set('api automation browser cloud css data desktop fetch frontend http mobile native network reactive security testing ui web workflow framework library database engine platform runtime compiler bundler router editor dashboard sdk'.split(' '))
  const terms = [...new Set(tokenize(`${repo.description} ${readme.slice(0, 4000)}`))]
  const domains = terms.filter(term => domainTerms.has(term)).slice(0, 3)
  const brand = ['app', 'api', 'cli', 'core', 'main', 'server', 'web'].includes(repo.name.toLowerCase()) ? '' : repo.name.toLowerCase().replace(/[^a-z0-9_-]/g, '')
  const queries = repo.topics.slice(0, 3).map(topic => `topic:${topic} ${base}`)
  if (brand)
    queries.unshift(`${[brand, domains[0]].filter(Boolean).join(' ')} in:name,description ${base}`)
  if (domains.length)
    queries.push(`${domains.join(' ')} in:name,description${repo.language ? ` language:${repo.language.replace(/[^a-z0-9+#.-]/gi, '')}` : ''} ${base}`)
  if (!queries.length)
    queries.push(`${repo.name.replace(/[^\w-]/g, '')} in:name,description ${base}`)
  return [...new Set(queries)].slice(0, 3)
}

function sparseVectors(documents: string[]) {
  const tokens = documents.map(tokenize)
  const frequency = new Map<string, number>()
  for (const words of tokens) {
    for (const word of new Set(words)) frequency.set(word, (frequency.get(word) ?? 0) + 1)
  }
  return tokens.map((words) => {
    const counts = new Map<string, number>()
    for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1)
    return new Map([...counts].map(([word, count]) => [word, count / Math.max(1, words.length) * (Math.log((documents.length + 1) / ((frequency.get(word) ?? 0) + 1)) + 1)]))
  })
}

const clamp = (value: number) => Math.max(0, Math.min(1, value))
const logNormalize = (value: number, max: number) => clamp(Math.log1p(value) / Math.log1p(max))
function freshness(date: string | null, days: number, now: number) {
  return date ? Math.exp(-Math.max(0, now - Date.parse(date)) / (days * 86_400_000)) : 0
}
function repoText(repo: Repository, readme: string) {
  return [repo.name, repo.description, ...repo.topics, readme.slice(0, 15000)].join('\n')
}

export function rankCandidates(target: Repository, readme: string, candidates: Array<{ repository: Repository, readme: string }>, now: number) {
  const vectors = sparseVectors([repoText(target, readme), ...candidates.map(item => repoText(item.repository, item.readme))])
  const norm = (vector: Map<string, number>) => Math.sqrt([...vector.values()].reduce((sum, value) => sum + value * value, 0))
  return candidates.map(({ repository }, index) => {
    const vector = vectors[index + 1]
    const denominator = norm(vectors[0]) * norm(vector)
    const semantic = denominator ? [...vectors[0]].reduce((sum, [word, value]) => sum + value * (vector.get(word) ?? 0), 0) / denominator : 0
    const overlap = target.topics.filter(topic => repository.topics.includes(topic)).length
    const union = new Set([...target.topics, ...repository.topics]).size
    const topic = union ? overlap / union : 0
    const language = target.language && target.language === repository.language ? 1 : 0
    const active = freshness(repository.pushedAt, 365, now)
    const adopted = logNormalize(repository.stars, 250000)
    const reasons: string[] = []
    if (topic >= 0.25)
      reasons.push('Topics 重合')
    if (semantic >= 0.25)
      reasons.push('README / 描述接近')
    if (language)
      reasons.push(`同为 ${repository.language}`)
    if (active >= 0.75)
      reasons.push('近期活跃')
    return { repository, score: clamp(semantic * 0.48 + topic * 0.18 + language * 0.08 + active * 0.13 + adopted * 0.13), reasons }
  }).sort((a, b) => b.score - a.score).slice(0, 8)
}

export function health(repository: Repository, latestRelease: RepoLensResult['latestRelease'], activity: RepoLensResult['activity'], now: number) {
  const parts: Array<[number, number]> = [[freshness(repository.pushedAt, 180, now), 0.55], [latestRelease ? freshness(latestRelease.publishedAt, 240, now) : 0, 0.2]]
  if (activity) {
    if (activity.issuesCreated > 0)
      parts.push([clamp(activity.issuesClosed / activity.issuesCreated), 0.1])
    if (activity.pullsCreated > 0)
      parts.push([clamp(activity.pullsMerged / activity.pullsCreated), 0.15])
  }
  return {
    maintenance: clamp(parts.reduce((sum, [value, weight]) => sum + value * weight, 0) / parts.reduce((sum, [, weight]) => sum + weight, 0)),
    adoption: clamp(logNormalize(repository.stars, 250000) * 0.7 + logNormalize(repository.forks, 50000) * 0.3),
  }
}

function escapeMarkdown(value: string) {
  return value.replace(/[\\`*_[\]<>|]/g, char => `\\${char}`).replace(/[\r\n]+/g, ' ')
}
export function markdownReport(result: Omit<RepoLensResult, 'report'>) {
  const repo = result.repository
  return [
    `# ${escapeMarkdown(repo.fullName)} — RepoLens`,
    '',
    `来源：https://github.com/${repo.fullName}`,
    `抓取时间：${new Date(result.fetchedAt).toISOString()}`,
    '',
    escapeMarkdown(repo.description),
    '',
    `Stars：${repo.stars} · Forks：${repo.forks} · 语言：${escapeMarkdown(repo.language ?? '未知')} · License：${escapeMarkdown(repo.license ?? '未知')}`,
    `维护活跃：${Math.round(result.health.maintenance * 100)} / 100 · 社区采用：${Math.round(result.health.adoption * 100)} / 100`,
    '评分是基于可见数据的筛选参考，不代表安全审计或适配性结论。',
    '',
    '## 相似项目',
    '',
    ...result.similar.map(item => `- ${escapeMarkdown(item.repository.fullName)}：${Math.round(item.score * 100)} / 100；${item.reasons.map(escapeMarkdown).join('、')}；https://github.com/${item.repository.fullName}`),
    '',
    '## 数据状态',
    '',
    ...(result.warnings.length ? result.warnings.map(warning => `- ${escapeMarkdown(warning)}`) : ['- 所有本次请求已完成。']),
    '- 相似度使用本机 TF-IDF；候选来自 GitHub Search，不保证穷尽。',
    '- Star 快照只在本机分析时记录，不补造历史。',
  ].join('\n')
}
