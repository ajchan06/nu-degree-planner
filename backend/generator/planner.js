import supabase from '../supabase.js'

export async function generatePlan(studentId) {
  const student = await loadStudent(studentId)
  const requirements = await loadRequirements(student.major_code, student.concentration)

  const completedCodes = new Set(
    student.student_courses
      .filter(c => ['completed', 'in_progress', 'ap', 'transfer_approved'].includes(c.status))
      .map(c => c.course_code)
  )
  const allDoneCodes = new Set([...completedCodes])

  const completedCredits = student.student_courses
    .filter(c => ['completed', 'in_progress', 'ap', 'transfer_approved'].includes(c.status))
    .reduce((sum, c) => sum + parseFloat(c.credits || 0), 0)

  const startYear = student.start_year || new Date().getFullYear()
  const startSemester = student.start_semester || 'Fall'
  const numCoops = student.num_coops || 2
  const coopPattern = student.coop_pattern || 'spring'

  // Use start_semester and start_year directly from DB
  // instead of inferring from current date
  const firstSemester = `${startSemester} ${startYear}`

  const unsatisfied = checkRequirements(requirements, completedCodes)
  const selected = selectCourses(unsatisfied, allDoneCodes, requirements)
  const ordered = topologicalSort(selected, requirements.prerequisites, requirements.validPrefixes)
  const withCoreqs = addCorequisites(ordered, requirements.corequisites, allDoneCodes, requirements.allCoursesMap)
  const { plan, targetGraduation } = packSemesters(
    withCoreqs, student, completedCodes, completedCredits,
    requirements, startYear, firstSemester, coopPattern, numCoops
  )

  return {
    student,
    plan,
    targetGraduation,
    summary: buildSummary(requirements, completedCodes, selected, completedCredits)
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
  const [groupsRes, prereqRes, nupathRes, coreqRes, concRes, allCoursesRes, prefixRes] = await Promise.all([
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
            is_lab,
            is_coreq,
            is_seminar,
            course_type
          )
        )
      `)
      .eq('major_code', majorCode),
    supabase.from('prerequisites').select('course_code, requires_code'),
    supabase.from('course_nupath').select('course_code, nupath_code'),
    supabase.from('corequisites').select('course_code, coreq_code'),
    concentration ? supabase
      .from('concentration_courses')
      .select('course_code, is_required, pick_n, group_id')
      .eq('major_code', majorCode)
      .eq('concentration_name', concentration) : { data: [], error: null },
    supabase.from('courses').select('code, title, credits, is_lab, is_coreq, is_seminar, course_type'),
    // Load distinct prefixes from courses table instead of hardcoding
    supabase.from('courses').select('code').not('code', 'is', null)
  ])

  if (groupsRes.error) throw new Error(groupsRes.error.message)
  if (prereqRes.error) throw new Error(prereqRes.error.message)
  if (nupathRes.error) throw new Error(nupathRes.error.message)
  if (coreqRes.error) throw new Error(coreqRes.error.message)
  if (allCoursesRes.error) throw new Error(allCoursesRes.error.message)

  // Extract unique prefixes from all course codes in the DB
  const validPrefixes = new Set(
    prefixRes.data
      .map(c => c.code.replace(/[0-9]/g, '').trim())
      .filter(p => p.length > 0)
  )

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
    allCoursesMap,
    validPrefixes
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
          group, missing: [], options: courses,
          type: 'ONE_OF', isNupath: true, nupathCode
        })
      }
      continue
    }

    if (group.name === 'General Electives') continue

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
          group, missing: [], options: courses,
          creditsNeeded: needed - earned, type: 'MIN_CREDITS'
        })
      }
    }
  }

  return unsatisfied
}

function getNupathCode(groupName) {
  const map = {
    'NUpath Natural Designed World': 'ND',
    'NUpath Creative Expression': 'EI',
    'NUpath Interpreting Culture': 'IC',
    'NUpath Formal Quantitative': 'FQ',
    'NUpath Societies Institutions': 'SI',
    'NUpath Analyzing Data': 'AD',
    'NUpath Difference Diversity': 'DD',
    'NUpath Ethical Reasoning': 'ER',
    'NUpath First Year Writing': 'WF',
    'NUpath Writing Intensive': 'WI',
    'NUpath Advanced Writing': 'WD',
    'NUpath Integration Experience': 'EX',
    'NUpath Capstone': 'CE'
  }
  return map[groupName] || null
}

function selectCourses(unsatisfied, allDoneCodes, requirements) {
  const selected = new Map()
  const satisfiedNupath = new Set()

  for (const code of allDoneCodes) {
    const nupath = requirements.nupathMap[code] || []
    nupath.forEach(n => satisfiedNupath.add(n))
  }

  const sorted = [...unsatisfied].sort((a, b) => {
    const priority = (r) => {
      if (r.type === 'ALL') return 0
      if (r.type === 'ONE_OF' && !r.isNupath) return 1
      if (r.type === 'ONE_OF' && r.isNupath) return 2
      return 3
    }
    return priority(a) - priority(b)
  })

  for (const req of sorted) {
    if (req.type === 'ALL') {
      for (const code of req.missing) {
        if (code === 'CS1210') continue
        if (!allDoneCodes.has(code) && !selected.has(code)) {
          const course = requirements.allCoursesMap[code]
          if (course && !course.is_coreq) {
            selected.set(code, course)
            const nupath = requirements.nupathMap[code] || []
            nupath.forEach(n => satisfiedNupath.add(n))
          }
        }
      }
    }

    if (req.type === 'ONE_OF') {
      if (req.isNupath && req.nupathCode && satisfiedNupath.has(req.nupathCode)) continue

      let best = null
      if (req.isNupath) {
        const unsatisfiedNupathCodes = requirements.groups
          .filter(g => g.is_nupath)
          .map(g => getNupathCode(g.name))
          .filter(code => code && !satisfiedNupath.has(code))

        let bestScore = -1
        for (const c of req.options) {
          if (allDoneCodes.has(c.code) || selected.has(c.code) || c.is_coreq) continue
          const nupath = requirements.nupathMap[c.code] || []
          const score = nupath.filter(n => unsatisfiedNupathCodes.includes(n)).length
          if (score > bestScore) { bestScore = score; best = c }
        }
      } else {
        best = req.options.find(c =>
          !allDoneCodes.has(c.code) && !selected.has(c.code) && !c.is_coreq
        )
      }

      if (best) {
        selected.set(best.code, best)
        const nupath = requirements.nupathMap[best.code] || []
        nupath.forEach(n => satisfiedNupath.add(n))
      }
    }

    if (req.type === 'MIN_CREDITS') {
      let creditsAdded = 0
      let scienceCoursesAdded = 0

      const isScienceReq = req.group.name === 'Science Requirement'
      const hardSciencePrefixes = ['BIOL', 'CHEM', 'ENVR', 'PHYS']

      const completedInReq = req.options.filter(c => allDoneCodes.has(c.code) && !c.is_coreq)
      const completedCreditsInReq = completedInReq.reduce((sum, c) => sum + parseFloat(c.credits || 0), 0)
      const completedScienceCourses = isScienceReq ? completedInReq.length : 0
      const minScienceCourses = isScienceReq ? Math.max(0, 2 - completedScienceCourses) : 0

      creditsAdded = completedCreditsInReq

      for (const course of req.options) {
        if (creditsAdded >= req.creditsNeeded && scienceCoursesAdded >= minScienceCourses) break
        if (allDoneCodes.has(course.code) || selected.has(course.code) || course.is_coreq) continue
        const isHardScience = hardSciencePrefixes.some(p => course.code.startsWith(p))
        if (creditsAdded >= req.creditsNeeded && isScienceReq && !isHardScience) continue
        selected.set(course.code, course)
        creditsAdded += parseFloat(course.credits)
        if (isScienceReq) scienceCoursesAdded++
        const nupath = requirements.nupathMap[course.code] || []
        nupath.forEach(n => satisfiedNupath.add(n))
      }
    }
  }

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
            if (courseData) { selected.set(cc.course_code, courseData); picked++ }
          }
        }
      }
    }
  }

  return Array.from(selected.values())
}

function topologicalSort(courses, prereqMap, validPrefixes) {
  const courseSet = new Set(courses.map(c => c.code))
  const visited = new Set()
  const result = []

  // Science prefixes are deprioritized relative to core academic prefixes.
  // They get a +1000 offset so they're placed later in the plan
  // since science courses are typically taken after establishing the CS foundation.
  // Non-science, non-core courses (humanities, social sciences, etc.) get a +500 offset
  // so they're placed in the middle — after core CS but before or alongside science.
  const sciencePrefixes = new Set(['BIOL', 'CHEM', 'PHYS', 'ENVR'])

  // Core prefixes are CS-adjacent disciplines that should be scheduled early
  // These are derived from validPrefixes loaded from the DB minus science prefixes
  const corePrefixes = new Set(
    [...validPrefixes].filter(p => !sciencePrefixes.has(p))
  )

  const SCIENCE_OFFSET = 1000  // Push science courses later in plan
  const OTHER_OFFSET = 500     // Push humanities/social sciences to middle

  const getPriority = (code) => {
    const num = parseInt(code.replace(/[^0-9]/g, '')) || 9999
    if (sciencePrefixes.has(code.replace(/[0-9]/g, ''))) return num + SCIENCE_OFFSET
    if (corePrefixes.has(code.replace(/[0-9]/g, ''))) return num
    return num + OTHER_OFFSET
  }

  const sorted = [...courses].sort((a, b) => getPriority(a.code) - getPriority(b.code))

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

  for (const course of sorted) visit(course.code)
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
          is_coreq: true,
          is_seminar: coreqData.is_seminar || false,
          course_type: coreqData.course_type || 'lab',
          _coreqOf: course.code
        })
      }
    }
  }

  return result
}

function buildCoopSemesters(startYear, numCoops, coopPattern) {
  const coops = new Set()
  if (coopPattern === 'spring') {
    coops.add(`Spring ${startYear + 2}`)
    coops.add(`Summer A ${startYear + 2}`)
    if (numCoops >= 2) {
      coops.add(`Spring ${startYear + 3}`)
      coops.add(`Summer A ${startYear + 3}`)
    }
  } else {
    coops.add(`Summer B ${startYear + 2}`)
    coops.add(`Fall ${startYear + 2}`)
    if (numCoops >= 2) {
      coops.add(`Summer B ${startYear + 3}`)
      coops.add(`Fall ${startYear + 3}`)
    }
  }
  return coops
}

function getFirstCoopSemester(startYear, coopPattern) {
  return coopPattern === 'spring'
    ? `Spring ${startYear + 2}`
    : `Summer B ${startYear + 2}`
}

function semesterToNumber(label) {
  const parts = label.split(' ')
  const year = parseInt(parts[parts.length - 1])
  const season = parts.slice(0, -1).join(' ')
  const seasonOrder = { 'Fall': 0, 'Spring': 1, 'Summer A': 2, 'Summer B': 3 }
  return year * 10 + (seasonOrder[season] ?? 0)
}

function placeCourseAt(code, semIndex, semesterPlans, placed, completedCodes, requirements) {
  if (completedCodes.has(code)) return
  if (placed.has(code)) return
  const courseData = requirements.allCoursesMap[code]
  if (!courseData) return
  semesterPlans[semIndex].courses.push(courseData)
  semesterPlans[semIndex].credits += parseFloat(courseData.credits || 0)
  placed.set(code, semIndex)
}

function packSemesters(orderedCourses, student, completedCodes, completedCredits, requirements, startYear, firstSemester, coopPattern, numCoops) {
  const TOTAL_CREDITS = 134
  const MAX_CREDITS = 19
  const SUMMER_MAX = 9
  const placed = new Map()
  const coopSemesters = buildCoopSemesters(startYear, numCoops, coopPattern)
  const firstCoopSemester = getFirstCoopSemester(startYear, coopPattern)
  const firstSemesterNum = semesterToNumber(firstSemester)

  const allSemesters = generateAllSemesters(startYear, firstSemester, coopSemesters, 24)
  const semesterPlans = allSemesters.map(s => ({
    semester: s.label,
    type: s.type,
    courses: [],
    credits: 0,
    upperDivCount: 0,
    isPast: false
  }))

  // Add COOP3945 to co-op semesters
  for (let i = 0; i < semesterPlans.length; i++) {
    if (semesterPlans[i].type === 'coop') {
      semesterPlans[i].courses.push({
        code: 'COOP3945', title: 'Co-op Work Experience',
        credits: 0, is_lab: false, is_coreq: false, course_type: 'lecture'
      })
    }
  }

  const firstFutureIndex = 0
  const firstCoopIndex = semesterPlans.findIndex(s => s.semester === firstCoopSemester)

  // Get all regular (non-coop, non-summer) semester indices
  const futureRegularSems = []
  for (let i = 0; i < semesterPlans.length; i++) {
    if (semesterPlans[i].type === 'regular') futureRegularSems.push(i)
  }

  // Build future semester index map for upper div limit tracking
  const futureSemIndexMap = []
  let idx = 0
  for (let i = 0; i < semesterPlans.length; i++) {
    if (semesterPlans[i].type !== 'coop') {
      futureSemIndexMap[i] = idx++
    }
  }

  // ── STEP 1: Hard-anchor core programming sequence ──
  // Semester 1: CS1200, CS1800, CS2000 (or CS2100 if CS2000 done)
  // Semester 2: CS2100 (or CS3100 if CS2100 done)
  // Semester 3: CS3100
  const sem1 = futureRegularSems[0]
  const sem2 = futureRegularSems[1]
  const sem3 = futureRegularSems[2]

  if (sem1 !== undefined) {
    placeCourseAt('CS1200', sem1, semesterPlans, placed, completedCodes, requirements)
    placeCourseAt('CS1800', sem1, semesterPlans, placed, completedCodes, requirements)
    if (!completedCodes.has('CS2000')) {
      placeCourseAt('CS2000', sem1, semesterPlans, placed, completedCodes, requirements)
    } else if (!completedCodes.has('CS2100')) {
      placeCourseAt('CS2100', sem1, semesterPlans, placed, completedCodes, requirements)
    }
  }

  if (sem2 !== undefined) {
    if (!completedCodes.has('CS2100') && !placed.has('CS2100')) {
      placeCourseAt('CS2100', sem2, semesterPlans, placed, completedCodes, requirements)
    } else if (!completedCodes.has('CS3100') && !placed.has('CS3100')) {
      placeCourseAt('CS3100', sem2, semesterPlans, placed, completedCodes, requirements)
    }
  }

  if (sem3 !== undefined) {
    if (!completedCodes.has('CS3100') && !placed.has('CS3100')) {
      placeCourseAt('CS3100', sem3, semesterPlans, placed, completedCodes, requirements)
    }
  }

  // ── STEP 2: Place CS1210 immediately before first co-op ──
  const cs1210Data = requirements.allCoursesMap['CS1210']
  if (cs1210Data && !completedCodes.has('CS1210')) {
    if (firstCoopIndex > 0) {
      for (let i = firstCoopIndex - 1; i >= 0; i--) {
        if (semesterPlans[i].type === 'regular') {
          semesterPlans[i].courses.push(cs1210Data)
          semesterPlans[i].credits += parseFloat(cs1210Data.credits || 0)
          placed.set('CS1210', i)
          break
        }
      }
    }
  }

  // ── STEP 3: Place all remaining regular courses ──
  const anchorCodes = new Set(['CS1200', 'CS1800', 'CS2000', 'CS2100', 'CS3100', 'CS1210'])
  const regularCourses = orderedCourses.filter(c => !c._coreqOf && !anchorCodes.has(c.code))
  const coreqCourses = orderedCourses.filter(c => c._coreqOf)

  for (const course of regularCourses) {
    if (!course.code || placed.has(course.code)) continue

    const prereqs = requirements.prerequisites[course.code] || []
    let earliestSemester = firstFutureIndex

    for (const prereq of prereqs) {
      if (completedCodes.has(prereq)) continue
      const prereqSemIndex = placed.get(prereq)
      if (prereqSemIndex !== undefined) {
        earliestSemester = Math.max(earliestSemester, prereqSemIndex + 1)
      }
    }

    const coreqCredits = (requirements.corequisites[course.code] || [])
      .filter(coreqCode => !completedCodes.has(coreqCode))
      .reduce((sum, coreqCode) => {
        const coreqData = requirements.allCoursesMap[coreqCode] || {}
        return sum + parseFloat(coreqData.credits || 0)
      }, 0)

    const courseCredits = parseFloat(course.credits || 0)
    const totalCredits = courseCredits + coreqCredits
    const courseNum = parseInt(course.code.replace(/[^0-9]/g, ''))
    const isUpperDiv = courseNum >= 3000

    for (let i = earliestSemester; i < semesterPlans.length; i++) {
      if (semesterPlans[i].type === 'coop') continue

      const maxForSem = semesterPlans[i].type === 'summer' ? SUMMER_MAX : MAX_CREDITS
      const semIdx = futureSemIndexMap[i] ?? 99
      const upperDivLimit = semIdx === 0 ? 1 : semIdx === 1 ? 2 : 99

      if (isUpperDiv && semesterPlans[i].upperDivCount >= upperDivLimit) continue
      if (semesterPlans[i].credits + totalCredits <= maxForSem) {
        semesterPlans[i].courses.push(course)
        semesterPlans[i].credits += courseCredits
        if (isUpperDiv) semesterPlans[i].upperDivCount++
        placed.set(course.code, i)
        break
      }
    }
  }

  // ── STEP 4: Place coreqs with their parents ──
  // First for anchor courses
  for (const code of anchorCodes) {
    if (completedCodes.has(code)) continue
    const semIndex = placed.get(code)
    if (semIndex === undefined) continue
    const coreqs = requirements.corequisites[code] || []
    for (const coreqCode of coreqs) {
      if (completedCodes.has(coreqCode) || placed.has(coreqCode)) continue
      const coreqData = requirements.allCoursesMap[coreqCode]
      if (!coreqData) continue
      semesterPlans[semIndex].courses.push({
        code: coreqCode,
        title: coreqData.title || coreqCode,
        credits: coreqData.credits || 0,
        is_lab: coreqData.is_lab || true,
        is_coreq: true,
        is_seminar: coreqData.is_seminar || false,
        course_type: coreqData.course_type || 'lab',
        _coreqOf: code
      })
      semesterPlans[semIndex].credits += parseFloat(coreqData.credits || 0)
      placed.set(coreqCode, semIndex)
    }
  }

  // Then remaining coreqs
  for (const course of coreqCourses) {
    if (!course.code || placed.has(course.code)) continue
    const parentIndex = placed.get(course._coreqOf)
    if (parentIndex !== undefined) {
      semesterPlans[parentIndex].courses.push(course)
      semesterPlans[parentIndex].credits += parseFloat(course.credits || 0)
      placed.set(course.code, parentIndex)
    }
  }

  // ── STEP 5: Fill electives ONLY after first co-op ──
  const requiredCreditsPlaced = orderedCourses
    .reduce((sum, c) => sum + parseFloat(c.credits || 0), 0)
  let totalCreditsPlaced = completedCredits + requiredCreditsPlaced
  let electiveCounter = 1

  // Find index of semester after the first co-op block ends
  let afterFirstCoopIndex = firstCoopIndex
  if (firstCoopIndex >= 0) {
    let j = firstCoopIndex
    while (j < semesterPlans.length && semesterPlans[j].type === 'coop') j++
    afterFirstCoopIndex = j
  }

  for (let i = afterFirstCoopIndex; i < semesterPlans.length && totalCreditsPlaced < TOTAL_CREDITS; i++) {
    if (semesterPlans[i].type === 'coop') {
      let j = i
      while (j < semesterPlans.length && semesterPlans[j].type === 'coop') j++
      i = j - 1
      continue
    }

    const maxForSem = semesterPlans[i].type === 'summer' ? SUMMER_MAX : MAX_CREDITS
    let remaining = maxForSem - semesterPlans[i].credits

    while (remaining >= 4 && totalCreditsPlaced < TOTAL_CREDITS) {
      semesterPlans[i].courses.push({
        code: `ELEC${String(electiveCounter).padStart(4, '0')}`,
        title: 'General Elective',
        credits: 4,
        is_elective: true
      })
      semesterPlans[i].credits += 4
      totalCreditsPlaced += 4
      remaining -= 4
      electiveCounter++
    }
  }

  // Find last semester with real courses
  let lastNonEmptySemIndex = 0
  for (let i = semesterPlans.length - 1; i >= 0; i--) {
    const realCourses = semesterPlans[i].courses.filter(c => c.code !== 'COOP3945')
    if (realCourses.length > 0) { lastNonEmptySemIndex = i; break }
  }

  const targetGraduation = semesterPlans[lastNonEmptySemIndex].semester

  const finalPlan = semesterPlans
    .slice(0, lastNonEmptySemIndex + 1)
    .filter(s => s.courses.length > 0 || s.type === 'coop')
    .map(({ upperDivCount, isPast, ...s }) => s)

  return { plan: finalPlan, targetGraduation }
}

function generateAllSemesters(startYear, firstSemester, coopSemesters, count) {
  const semesters = []
  const parts = firstSemester.split(' ')
  let season = parts[0]
  let year = parseInt(parts[parts.length - 1])

  for (let i = 0; i < count; i++) {
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
    }

    if (season === 'Fall') { season = 'Spring'; year += 1 }
    else { season = 'Fall' }
  }

  return semesters
}

function buildSummary(requirements, completedCodes, selectedCourses, completedCredits) {
  const selectedCodes = new Set(selectedCourses.map(c => c.code))
  const allCodes = new Set([...completedCodes, ...selectedCodes])
  const summary = []

  const satisfiedNupath = new Set()
  for (const code of allCodes) {
    const nupath = requirements.nupathMap[code] || []
    nupath.forEach(n => satisfiedNupath.add(n))
  }
  satisfiedNupath.add('EX')

  const totalSelectedCredits = selectedCourses
    .reduce((sum, c) => sum + parseFloat(c.credits || 0), 0)
  const totalCredits = completedCredits + totalSelectedCredits

  for (const group of requirements.groups) {
    const optionCodes = group.requirement_courses.map(rc => rc.course_code)
    const completedInGroup = optionCodes.filter(code => completedCodes.has(code))
    const plannedInGroup = optionCodes.filter(code => selectedCodes.has(code))
    let status = 'unsatisfied'

    if (group.name === 'General Electives') {
      const creditsNeeded = Math.max(0, 134 - totalCredits)
      status = creditsNeeded <= 0 ? 'complete' : 'unsatisfied'
      summary.push({
        name: group.name, rule_type: group.rule_type, status,
        completed: completedInGroup, planned: plannedInGroup,
        credits_needed: Math.round(creditsNeeded), nupath_satisfied: null
      })
      continue
    }

    if (group.is_nupath) {
      const nupathCode = getNupathCode(group.name)
      if (nupathCode && satisfiedNupath.has(nupathCode)) {
        status = completedInGroup.length > 0 ? 'complete' : 'planned'
      }
    } else if (group.rule_type === 'ALL') {
      const allRequired = group.requirement_courses
        .filter(rc => rc.is_required).map(rc => rc.course_code)
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
      status = plannedInGroup.length > 0 || completedInGroup.length > 0 ? 'planned' : 'unsatisfied'
    }

    summary.push({
      name: group.name, rule_type: group.rule_type, status,
      completed: completedInGroup, planned: plannedInGroup,
      nupath_satisfied: group.is_nupath
        ? satisfiedNupath.has(getNupathCode(group.name))
        : null
    })
  }

  return summary
}