import supabase from '../supabase.js'

export async function generatePlan(studentId) {
  const student = await loadStudent(studentId)
  const requirements = await loadRequirements(student.major_code, student.concentration)

  const completedCodes = new Set(
    student.student_courses
      .filter(c => ['completed', 'in_progress', 'ap', 'transfer_approved'].includes(c.status))
      .map(c => c.course_code)
  )
  const plannedCodes = new Set(
    student.student_courses
      .filter(c => c.status === 'planned')
      .map(c => c.course_code)
  )
  const allDoneCodes = new Set([...completedCodes, ...plannedCodes])

  const unsatisfied = checkRequirements(requirements, completedCodes)
  const selected = selectCourses(unsatisfied, allDoneCodes, requirements)
  const ordered = topologicalSort(selected, requirements.prerequisites)
  const withCoreqs = addCorequisites(ordered, requirements.corequisites, allDoneCodes, requirements.allCoursesMap)
  const plan = packSemesters(withCoreqs, student, completedCodes, requirements)

  return {
    student,
    plan,
    summary: buildSummary(requirements, completedCodes, selected)
  }
}

async function loadStudent(studentId) {
  const { data, error } = await supabase
    .from('students')
    .select(`
      *,
      student_courses (
        course_code,
        status,
        grade,
        credits,
        semester,
        source
      )
    `)
    .eq('id', studentId)
    .single()

  if (error) throw new Error(`Failed to load student: ${error.message}`)
  return data
}

async function loadRequirements(majorCode, concentration) {
  const [groupsRes, prereqRes, nupathRes, coreqRes, concRes, allCoursesRes] = await Promise.all([
    supabase
      .from('requirement_groups')
      .select(`
        *,
        requirement_courses (
          course_code,
          is_required,
          courses (
            code,
            title,
            credits,
            is_lab
          )
        )
      `)
      .eq('major_code', majorCode),

    supabase
      .from('prerequisites')
      .select('course_code, requires_code'),

    supabase
      .from('course_nupath')
      .select('course_code, nupath_code'),

    supabase
      .from('corequisites')
      .select('course_code, coreq_code'),

    concentration ? supabase
      .from('concentration_courses')
      .select('course_code, is_required, pick_n, group_id')
      .eq('major_code', majorCode)
      .eq('concentration_name', concentration) : { data: [], error: null },

    supabase
      .from('courses')
      .select('code, title, credits, is_lab')
  ])

  if (groupsRes.error) throw new Error(groupsRes.error.message)
  if (prereqRes.error) throw new Error(prereqRes.error.message)
  if (nupathRes.error) throw new Error(nupathRes.error.message)
  if (coreqRes.error) throw new Error(coreqRes.error.message)
  if (allCoursesRes.error) throw new Error(allCoursesRes.error.message)

  const nupathMap = {}
  for (const row of nupathRes.data) {
    if (!nupathMap[row.course_code]) nupathMap[row.course_code] = []
    nupathMap[row.course_code].push(row.nupath_code)
  }

  const prereqMap = {}
  for (const row of prereqRes.data) {
    if (!prereqMap[row.course_code]) prereqMap[row.course_code] = []
    prereqMap[row.course_code].push(row.requires_code)
  }

  const coreqMap = {}
  for (const row of coreqRes.data) {
    if (!coreqMap[row.course_code]) coreqMap[row.course_code] = []
    coreqMap[row.course_code].push(row.coreq_code)
  }

  const allCoursesMap = {}
  for (const c of allCoursesRes.data) {
    allCoursesMap[c.code] = c
  }

  return {
    groups: groupsRes.data,
    prerequisites: prereqMap,
    nupathMap,
    corequisites: coreqMap,
    concentrationCourses: concRes.data || [],
    allCoursesMap
  }
}

function checkRequirements(requirements, completedCodes) {
  const unsatisfied = []
  const satisfiedNupath = new Set()

  for (const code of completedCodes) {
    const nupath = requirements.nupathMap[code] || []
    nupath.forEach(n => satisfiedNupath.add(n))
  }

  for (const group of requirements.groups) {
    const courses = group.requirement_courses
      .map(rc => requirements.allCoursesMap[rc.course_code])
      .filter(Boolean)
    const requiredCodes = group.requirement_courses
      .filter(rc => rc.is_required)
      .map(rc => rc.course_code)
    const optionCodes = group.requirement_courses.map(rc => rc.course_code)

    if (group.is_nupath) {
      const nupathCode = getNupathCode(group.name)
      if (nupathCode && satisfiedNupath.has(nupathCode)) continue
      const satisfied = optionCodes.some(code => completedCodes.has(code))
      if (!satisfied) {
        unsatisfied.push({
          group,
          missing: [],
          options: courses,
          type: 'ONE_OF',
          isNupath: true,
          nupathCode
        })
      }
      continue
    }

    if (group.rule_type === 'ALL') {
      const missing = requiredCodes.filter(code => !completedCodes.has(code))
      if (missing.length > 0) {
        unsatisfied.push({ group, missing, options: courses, type: 'ALL' })
      }
    }

    if (group.rule_type === 'ONE_OF') {
      const satisfied = optionCodes.some(code => completedCodes.has(code))
      if (!satisfied) {
        unsatisfied.push({ group, missing: [], options: courses, type: 'ONE_OF' })
      }
    }

    if (group.rule_type === 'MIN_CREDITS') {
      const earned = optionCodes
        .filter(code => completedCodes.has(code))
        .reduce((sum, code) => {
          const course = requirements.allCoursesMap[code]
          return sum + (course ? parseFloat(course.credits) : 0)
        }, 0)
      const needed = parseFloat(group.min_credits || 0)
      if (earned < needed) {
        unsatisfied.push({
          group,
          missing: [],
          options: courses,
          creditsNeeded: needed - earned,
          type: 'MIN_CREDITS'
        })
      }
    }
  }

  return unsatisfied
}

function getNupathCode(groupName) {
  const map = {
    'NUpath Natural Designed World':  'ND',
    'NUpath Creative Expression':     'EI',
    'NUpath Interpreting Culture':    'IC',
    'NUpath Formal Quantitative':     'FQ',
    'NUpath Societies Institutions':  'SI',
    'NUpath Analyzing Data':          'AD',
    'NUpath Difference Diversity':    'DD',
    'NUpath Ethical Reasoning':       'ER',
    'NUpath First Year Writing':      'WF',
    'NUpath Writing Intensive':       'WI',
    'NUpath Advanced Writing':        'WD',
    'NUpath Integration Experience':  'EX',
    'NUpath Capstone':                'CE'
  }
  return map[groupName] || null
}

function selectCourses(unsatisfied, allDoneCodes, requirements) {
  const selected = new Map()
  const satisfiedNupath = new Set()

  const sorted = [...unsatisfied].sort((a, b) => a.options.length - b.options.length)

  for (const req of sorted) {
    if (req.type === 'ALL') {
      for (const code of req.missing) {
        if (!allDoneCodes.has(code) && !selected.has(code)) {
          const course = requirements.allCoursesMap[code]
          if (course && !course.is_lab) {
            selected.set(code, course)
            const nupath = requirements.nupathMap[code] || []
            nupath.forEach(n => satisfiedNupath.add(n))
          }
        }
      }
    }

    if (req.type === 'ONE_OF') {
      if (req.isNupath && req.nupathCode && satisfiedNupath.has(req.nupathCode)) continue
      const best = req.options.find(c =>
        !allDoneCodes.has(c.code) && !selected.has(c.code) && !c.is_lab
      )
      if (best) {
        selected.set(best.code, best)
        const nupath = requirements.nupathMap[best.code] || []
        nupath.forEach(n => satisfiedNupath.add(n))
      }
    }

    if (req.type === 'MIN_CREDITS') {
      let creditsAdded = 0
      for (const course of req.options) {
        if (creditsAdded >= req.creditsNeeded) break
        if (!allDoneCodes.has(course.code) && !selected.has(course.code) && !course.is_lab) {
          selected.set(course.code, course)
          creditsAdded += parseFloat(course.credits)
          const nupath = requirements.nupathMap[course.code] || []
          nupath.forEach(n => satisfiedNupath.add(n))
        }
      }
    }
  }

  // Add concentration courses
  if (requirements.concentrationCourses.length > 0) {
    const byGroup = {}
    for (const cc of requirements.concentrationCourses) {
      if (!byGroup[cc.group_id]) byGroup[cc.group_id] = []
      byGroup[cc.group_id].push(cc)
    }

    for (const groupId of Object.keys(byGroup).sort()) {
      const group = byGroup[groupId]
      const required = group.filter(c => c.is_required)
      const optional = group.filter(c => !c.is_required)
      const pickN = required.length > 0 ? required.length : (optional[0]?.pick_n || 0)

      if (required.length > 0) {
        for (const cc of required) {
          if (!allDoneCodes.has(cc.course_code) && !selected.has(cc.course_code)) {
            const courseData = requirements.allCoursesMap[cc.course_code]
            if (courseData) selected.set(cc.course_code, courseData)
          }
        }
      } else {
        let picked = 0
        for (const cc of optional) {
          if (picked >= pickN) break
          if (!allDoneCodes.has(cc.course_code) && !selected.has(cc.course_code)) {
            const courseData = requirements.allCoursesMap[cc.course_code]
            if (courseData) {
              selected.set(cc.course_code, courseData)
              picked++
            }
          }
        }
      }
    }
  }

  return Array.from(selected.values())
}

function topologicalSort(courses, prereqMap) {
  const courseSet = new Set(courses.map(c => c.code))
  const visited = new Set()
  const result = []

  function visit(code) {
    if (visited.has(code)) return
    visited.add(code)
    const prereqs = prereqMap[code] || []
    for (const prereq of prereqs) {
      if (courseSet.has(prereq)) visit(prereq)
    }
    const course = courses.find(c => c.code === code)
    if (course) result.push(course)
  }

  for (const course of courses) visit(course.code)
  return result
}

function addCorequisites(courses, coreqMap, allDoneCodes, allCoursesMap) {
  const result = []
  const courseSet = new Set(courses.map(c => c.code))

  for (const course of courses) {
    result.push(course)
    const coreqs = coreqMap[course.code] || []
    for (const coreqCode of coreqs) {
      if (!courseSet.has(coreqCode) && !allDoneCodes.has(coreqCode)) {
        courseSet.add(coreqCode)
        const coreqData = allCoursesMap[coreqCode] || {}
        result.push({
          code: coreqCode,
          title: coreqData.title || coreqCode,
          credits: coreqData.credits || 0,
          is_lab: coreqData.is_lab || true,
          _coreqOf: course.code
        })
      }
    }
  }

  return result
}

function packSemesters(orderedCourses, student, completedCodes, requirements) {
  const MAX_CREDITS = 19
  const SUMMER_MAX = 9
  const placed = new Map()
  const semesters = generateSemesters(student.target_graduation, student.catalog_year)
  const semesterPlans = semesters.map(s => ({
    semester: s.label,
    type: s.type,
    courses: [],
    credits: 0
  }))

  for (let i = 0; i < semesterPlans.length; i++) {
    if (semesterPlans[i].type === 'coop') {
      semesterPlans[i].courses.push({
        code: 'COOP3945',
        title: 'Co-op Work Experience',
        credits: 0,
        is_lab: false
      })
    }
  }

  const regularCourses = orderedCourses.filter(c => !c._coreqOf)
  const coreqCourses = orderedCourses.filter(c => c._coreqOf)

  for (const course of regularCourses) {
    if (!course.code) continue

    const prereqs = requirements.prerequisites[course.code] || []
    let earliestSemester = 0

    for (const prereq of prereqs) {
      if (completedCodes.has(prereq)) continue
      const prereqSemIndex = placed.get(prereq)
      if (prereqSemIndex !== undefined) {
        earliestSemester = Math.max(earliestSemester, prereqSemIndex + 1)
      }
    }

    for (let i = earliestSemester; i < semesterPlans.length; i++) {
      if (semesterPlans[i].type === 'coop') continue
      const maxForSem = semesterPlans[i].type === 'summer' ? SUMMER_MAX : MAX_CREDITS
      if (semesterPlans[i].credits + parseFloat(course.credits || 0) <= maxForSem) {
        semesterPlans[i].courses.push(course)
        semesterPlans[i].credits += parseFloat(course.credits || 0)
        placed.set(course.code, i)
        break
      }
    }
  }

  for (const course of coreqCourses) {
    if (!course.code) continue
    const parentIndex = placed.get(course._coreqOf)
    if (parentIndex !== undefined) {
      semesterPlans[parentIndex].courses.push(course)
      semesterPlans[parentIndex].credits += parseFloat(course.credits || 0)
      placed.set(course.code, parentIndex)
    }
  }

  return semesterPlans.filter(s => s.courses.length > 0 || s.type === 'coop')
}

function generateSemesters(targetGraduation, catalogYear) {
  const semesters = []
  const now = new Date()
  const currentMonth = now.getMonth()
  const currentYear = now.getFullYear()
  let year = currentYear
  let season = currentMonth < 7 ? 'Fall' : 'Spring'
  if (season === 'Spring') year += 1

  const startYear = year

  const coopSemesters = new Set([
    `Spring ${startYear + 1}`,
    `Summer A ${startYear + 2}`,
    `Spring ${startYear + 2}`,
    `Summer A ${startYear + 3}`
  ])

  for (let i = 0; i < 16; i++) {
    const labels = season === 'Fall'
      ? [`Fall ${year}`]
      : [`Spring ${year}`, `Summer A ${year}`, `Summer B ${year}`]

    for (const label of labels) {
      const isCoop = coopSemesters.has(label)
      const isSummer = label.includes('Summer')
      semesters.push({
        label,
        type: isCoop ? 'coop' : isSummer ? 'summer' : 'regular'
      })
      if (label === targetGraduation) return semesters
    }

    if (season === 'Fall') {
      season = 'Spring'
      year += 1
    } else {
      season = 'Fall'
    }
  }

  return semesters
}

function buildSummary(requirements, completedCodes, selectedCourses) {
  const selectedCodes = new Set(selectedCourses.map(c => c.code))
  const allCodes = new Set([...completedCodes, ...selectedCodes])
  const summary = []

  const satisfiedNupath = new Set()
  for (const code of allCodes) {
    const nupath = requirements.nupathMap[code] || []
    nupath.forEach(n => satisfiedNupath.add(n))
  }
  satisfiedNupath.add('EX')

  for (const group of requirements.groups) {
    const optionCodes = group.requirement_courses.map(rc => rc.course_code)
    const completedInGroup = optionCodes.filter(code => completedCodes.has(code))
    const plannedInGroup = optionCodes.filter(code => selectedCodes.has(code))

    let status = 'unsatisfied'

    if (group.is_nupath) {
      const nupathCode = getNupathCode(group.name)
      if (nupathCode && satisfiedNupath.has(nupathCode)) {
        status = completedInGroup.length > 0 ? 'complete' : 'planned'
      }
    } else if (group.rule_type === 'ALL') {
      const allRequired = group.requirement_courses
        .filter(rc => rc.is_required)
        .map(rc => rc.course_code)
      const allDone = allRequired.every(code =>
        completedCodes.has(code) || selectedCodes.has(code)
      )
      status = allDone
        ? completedInGroup.length === allRequired.length ? 'complete' : 'planned'
        : 'unsatisfied'
    } else if (group.rule_type === 'ONE_OF') {
      if (completedInGroup.length > 0) status = 'complete'
      else if (plannedInGroup.length > 0) status = 'planned'
    } else if (group.rule_type === 'MIN_CREDITS') {
      status = plannedInGroup.length > 0 || completedInGroup.length > 0
        ? 'planned'
        : 'unsatisfied'
    }

    summary.push({
      name: group.name,
      rule_type: group.rule_type,
      status,
      completed: completedInGroup,
      planned: plannedInGroup,
      nupath_satisfied: group.is_nupath
        ? satisfiedNupath.has(getNupathCode(group.name))
        : null
    })
  }

  return summary
}