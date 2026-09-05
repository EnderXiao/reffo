import type { EvidenceAtom, GeneratedResumeArtifact, ResumeEvidenceBundle, V5ResumePlan } from '@/v5/types'
import { V5_SCHEMA_VERSION } from '@/v5/types'
import { measureArtifactMarkdown, plannedContentEvidenceIds } from '@/v5/validators'

function sectionTitle(key: string, language: string) {
  const english = !/zh|cjk|mixed/i.test(language)
  const labels: Record<string, [string, string]> = {
    experience: ['Work Experience', '工作经历'],
    project: ['Projects', '项目经历'],
    research: ['Research', '研究经历'],
    education: ['Education', '教育背景'],
    skills: ['Skills', '专业技能'],
    portfolio: ['Portfolio', '作品集'],
    certifications: ['Certifications', '证书'],
    languages: ['Languages', '语言能力'],
    publications: ['Publications', '论文发表'],
    patents: ['Patents', '专利'],
    awards: ['Awards', '荣誉奖项'],
    other: ['Other Experience', '其他经历'],
  }
  return labels[key]?.[english ? 0 : 1] ?? key
}

function metadataLine(item: ResumeEvidenceBundle['timeline'][number]) {
  return [item.organization, item.title, [item.start, item.end].filter(Boolean).join(' - ')]
    .filter(Boolean)
    .join('｜')
}

function strongestAllowedAttribution(atoms: EvidenceAtom[]) {
  const rank = { unspecified: 0, supported: 1, contributed: 2, drove: 3, owned: 4 } as const
  return [...atoms].sort((left, right) => rank[left.attributionLevel] - rank[right.attributionLevel])[0]?.attributionLevel ?? 'unspecified'
}

function withoutMarkdownPresentationMarker(value: string) {
  return value.trim().replace(/^(?:(?:[-*+]|#{1,6})\s+)+/, '').trim()
}

function markdownListItem(values: string[]) {
  return `- ${values.map(withoutMarkdownPresentationMarker).join('；')}`
}

export function renderSourcePreservingArtifact(input: {
  resume: ResumeEvidenceBundle
  plan: V5ResumePlan
}): GeneratedResumeArtifact {
  const { resume, plan } = input
  const evidence = new Map(resume.evidenceAtoms.map(atom => [atom.evidenceId, atom]))
  const scopePlans = new Map(plan.scopePlans.map(item => [item.scopeId, item]))
  const claims: GeneratedResumeArtifact['claims'] = []
  const lines: string[] = []
  const used = new Set<string>()
  const renderedClaimLines = new Set<string>()
  let claimIndex = 0

  const appendClaim = (outputPath: string, outputText: string, atoms: EvidenceAtom[]) => {
    if (!outputText.trim() || atoms.length === 0) return
    const normalizedLine = outputText.trim()
    if (renderedClaimLines.has(normalizedLine)) return
    renderedClaimLines.add(normalizedLine)
    const normalizedOutput = withoutMarkdownPresentationMarker(outputText)
    const transformation = atoms.length === 1 && normalizedOutput === withoutMarkdownPresentationMarker(atoms[0].verbatimText)
      ? 'verbatim'
      : atoms.length > 1
        ? 'same_scope_merge'
        : 'safe_paraphrase'
    claimIndex += 1
    lines.push(outputText)
    for (const atom of atoms) used.add(atom.evidenceId)
    claims.push({
      claimId: `safe_claim_${String(claimIndex).padStart(4, '0')}`,
      outputPath,
      outputText,
      evidenceIds: [...new Set(atoms.map(atom => atom.evidenceId))],
      transformation,
      attributionLevel: strongestAllowedAttribution(atoms),
    })
  }

  if (resume.identity.name.value) lines.push(`# ${resume.identity.name.value}`)
  else lines.push('# Resume')
  lines.push('')
  const identityFields = [
    ['email', resume.identity.email],
    ['phone', resume.identity.phone],
    ['location', resume.identity.cityLevelLocation],
  ] as const
  for (const [field, identity] of identityFields) {
    const atoms = identity.evidenceIds
      .filter(id => !used.has(id))
      .map(id => evidence.get(id))
      .filter((atom): atom is EvidenceAtom => Boolean(atom && atom.status !== 'excluded'))
    if (identity.value && atoms.length > 0) appendClaim(`identity.${field}`, identity.value, atoms)
  }
  for (const [index, link] of resume.identity.links.entries()) {
    const atoms = link.evidenceIds
      .filter(id => !used.has(id))
      .map(id => evidence.get(id))
      .filter((atom): atom is EvidenceAtom => Boolean(atom && atom.status !== 'excluded'))
    if (atoms.length > 0) appendClaim(`identity.links[${index}]`, link.url, atoms)
  }

  const selectedOrder = [...plannedContentEvidenceIds(resume, plan)]
  const selected = new Set(selectedOrder)
  const selectedAtomsInOrder = [...selected]
    .map(id => evidence.get(id))
    .filter((atom): atom is EvidenceAtom => Boolean(
      atom && atom.status !== 'excluded' && !atom.riskFlags.includes('sensitive_pii')
    ))
  let remainingListItems = plan.generationPolicy.hardTotalListItemMax

  const appendScopeSection = (key: string, kinds: string[]) => {
    const scopes = resume.timeline.filter(item => kinds.includes(item.kind))
    const sectionLines: Array<
      | { kind: 'heading'; text: string }
      | { kind: 'claim'; path: string; text: string; atoms: EvidenceAtom[] }
    > = []
    for (const scope of scopes) {
      const scopePlan = scopePlans.get(scope.scopeId)
      if (!scopePlan) continue
      const atoms = selectedAtomsInOrder.filter(atom => (
        atom.sourceScopeId === scope.scopeId
        && atom.claimType !== 'identity'
        && atom.claimType !== 'timeline'
        && !used.has(atom.evidenceId)
      ))
      if (scopePlan.treatment === 'omit') continue
      if (scopePlan.treatment === 'timeline_line' || atoms.length === 0 || remainingListItems <= 0) {
        const timelineAtoms = scope.evidenceIds
          .filter(id => !used.has(id))
          .map(id => evidence.get(id))
          .filter((atom): atom is EvidenceAtom => Boolean(
            atom
            && atom.status !== 'excluded'
            && atom.claimType === 'timeline'
            && !atom.riskFlags.includes('sensitive_pii')
          ))
        const text = metadataLine(scope)
        if (text && timelineAtoms.length > 0) {
          sectionLines.push({ kind: 'claim', path: `timeline.${scope.scopeId}`, text, atoms: timelineAtoms })
          for (const atom of timelineAtoms) used.add(atom.evidenceId)
        }
        continue
      }
      const requestedBudget = Math.max(1, scopePlan.bulletBudget)
      const groupCount = Math.min(requestedBudget, remainingListItems, atoms.length)
      if (groupCount === 0) continue
      const heading = metadataLine(scope)
      if (!heading) continue
      const atomGroups = Array.from({ length: groupCount }, () => [] as EvidenceAtom[])
      for (const [index, atom] of atoms.entries()) atomGroups[index % groupCount].push(atom)
      sectionLines.push({ kind: 'heading', text: `### ${heading}` })
      for (const [index, atomGroup] of atomGroups.entries()) {
        sectionLines.push({
          kind: 'claim',
          path: `${key}.${scope.scopeId}.bullets[${index}]`,
          text: markdownListItem(atomGroup.map(atom => atom.verbatimText)),
          atoms: atomGroup,
        })
        for (const atom of atomGroup) used.add(atom.evidenceId)
        remainingListItems -= 1
      }
    }
    if (sectionLines.length === 0) return
    lines.push(`## ${sectionTitle(key, resume.sourceDocument.primaryLanguage)}`)
    lines.push('')
    for (const item of sectionLines) {
      if (item.kind === 'heading') {
        lines.push(item.text, '')
      } else {
        appendClaim(item.path, item.text, item.atoms)
      }
    }
    lines.push('')
  }

  const appendStandaloneEvidenceSection = (key: string, claimTypes: EvidenceAtom['claimType'][]) => {
    const atoms = selectedAtomsInOrder
      .filter(atom => claimTypes.includes(atom.claimType) && !used.has(atom.evidenceId))
      .slice(0, remainingListItems)
    if (atoms.length === 0 || remainingListItems <= 0) return
    lines.push(`## ${sectionTitle(key, resume.sourceDocument.primaryLanguage)}`)
    lines.push('')
    for (const [index, atom] of atoms.entries()) {
      appendClaim(`${key}[${index}]`, markdownListItem([atom.verbatimText]), [atom])
      used.add(atom.evidenceId)
      remainingListItems -= 1
    }
    lines.push('')
  }

  for (const section of plan.generationPolicy.sectionOrder) {
    if (section === 'identity' || section === 'summary') continue
    if (section === 'experience') appendScopeSection('experience', ['experience', 'internship'])
    else if (section === 'project') appendScopeSection('project', ['project'])
    else if (section === 'research') appendScopeSection('research', ['research'])
    else if (section === 'education') appendScopeSection('education', ['education'])
    else if (section === 'certifications') appendStandaloneEvidenceSection('certifications', ['certification'])
    else if (section === 'languages') appendStandaloneEvidenceSection('languages', ['language'])
    else if (section === 'publications') appendStandaloneEvidenceSection('publications', ['publication'])
    else if (section === 'patents') appendStandaloneEvidenceSection('patents', ['patent'])
    else if (section === 'awards') appendStandaloneEvidenceSection('awards', ['award'])
    else if (section === 'portfolio') appendStandaloneEvidenceSection('portfolio', ['portfolio_link'])
    else if (section === 'skills') {
      const atoms = plan.featuredSkillEvidenceIds
        .map(id => evidence.get(id))
        .filter((atom): atom is EvidenceAtom => Boolean(
          atom
          && atom.status !== 'excluded'
          && atom.claimType === 'skill'
          && !atom.riskFlags.includes('sensitive_pii')
        ))
        .filter(atom => !used.has(atom.evidenceId))
        .slice(0, remainingListItems)
      if (atoms.length > 0 && remainingListItems > 0) {
        lines.push(`## ${sectionTitle('skills', resume.sourceDocument.primaryLanguage)}`)
        lines.push('')
        for (const [index, atom] of atoms.entries()) {
          appendClaim(`skills[${index}]`, markdownListItem([atom.verbatimText]), [atom])
          used.add(atom.evidenceId)
          remainingListItems -= 1
        }
        lines.push('')
      }
    }
  }

  const markdown = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  const usedEvidenceIds = [...new Set(claims.flatMap(claim => claim.evidenceIds))]
  const plannedEvidence = new Set(selectedOrder)
  return {
    schemaVersion: V5_SCHEMA_VERSION,
    markdown,
    claims,
    usedEvidenceIds,
    omittedPlannedEvidenceIds: [...plannedEvidence].filter(id => !usedEvidenceIds.includes(id)),
    renderStats: measureArtifactMarkdown(markdown),
  }
}
