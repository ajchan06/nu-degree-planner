import supabase from '../supabase.js'

// ─── MAIN ENTRY POINT ───────────────────────────────────────────────────────
export async function generatePlan(studentId) {
  const student = await loadStudent(studentId)
  const requirements = await loadRequirements(student.major_code)
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
  const selected = selectCourses(unsatisfied, allDoneCodes)
  const ordered = topologicalSort(selected, requirements.prerequisites)
  const plan = packSemesters(ordered, student, completedCodes, requirements.prerequisites)

  return {
    student,
    plan,
    summary: buildSummary(requirements, completedCodes, selected)
  }
}

// ─── STEP 1: LOAD DATA ──────────────────────────────────────────────────────
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

async function loadRequirements(majorCode) {
  const [groupsRes, prereqRes, nupathRes] = await Promise.all([
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
      .select('course_code, nupath_code')
  ])

  if (groupsRes.error) throw new Error(groupsRes.error.message)
  if (prereqRes.error) throw new Error(prereqRes.error.message)
  if (nupathRes.error) throw new Error(nupathRes.error.message)

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

  return {
    groups: groupsRes.data,
    prerequisites: prereqMap,
    nupathMap
  }
}

// ─── STEP 2: CHECK REQUIREMENTS ─────────────────────────────────────────────
function checkRequirements(requirements, completedCodes) {
  const unsatisfied = []

  for (const group of requirements.groups) {
    const courses = group.requirement_courses.map(rc => rc.courses).filter(Boolean)
    const requiredCodes = group.requirement_courses
      .filter(rc => rc.is_required)
      .map(rc => rc.course_code)
    const optionCodes = group.requirement_courses.map(rc => rc.course_code)

    if (group.rule_type === 'ALL') {
      const missing = requiredCodes.filter(code => !completedCodes.has(code))
      if (missing.length > 0) {
        unsatisfied.push({
          group,
          missing,
          options: courses,
          type: 'ALL'
        })
      }
    }

    if (group.rule_type === 'ONE_OF') {
      const satisfied = optionCodes.some(code => completedCodes.has(code))
      if (!satisfied) {
        unsatisfied.push({
          group,
          missing: [],
          options: courses,
          type: 'ONE_OF'
        })
      }
    }

    if (group.rule_type === 'MIN_CREDITS') {
      const earned = optionCodes
        .filter(code => completedCodes.has(code))
        .reduce((sum, code) => {
          const course = courses.find(c => c.code === code)
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

// ─── STEP 3 + 4: SELECT COURSES ─────────────────────────────────────────────
function selectCourses(unsatisfied, allDoneCodes) {
  const selected = new Map()
  const requirementsFilled = new Set()

  // Sort by fewest options first — greedy matching
  // Requirements with fewer choices get filled first
  const sorted = [...unsatisfied].sort((a, b) => a.options.length - b.options.length)

  for (const req of sorted) {
    if (req.type === 'ALL') {
      for (const code of req.missing) {
        if (!allDoneCodes.has(code) && !selected.has(code)) {
          const course = req.options.find(c => c.code === code)
          if (course) selected.set(code, course)
        }
      }
    }

    if (req.type === 'ONE_OF') {
      // Find a course not already selected that satisfies this requirement
      const best = req.options.find(c =>
        !allDoneCodes.has(c.code) && !selected.has(c.code)
      )
      if (best) selected.set(best.code, best)
    }

    if (req.type === 'MIN_CREDITS') {
      let creditsAdded = 0
      for (const course of req.options) {
        if (creditsAdded >= req.creditsNeeded) break
        if (!allDoneCodes.has(course.code) && !selected.has(course.code)) {
          selected.set(course.code, course)
          creditsAdded += parseFloat(course.credits)
        }
      }
    }
  }

  return Array.from(selected.values())
}

// ─── STEP 5: TOPOLOGICAL SORT ───────────────────────────────────────────────
function topologicalSort(courses, prereqMap) {
  const courseSet = new Set(courses.map(c => c.code))
  const visited = new Set()
  const result = []

  function visit(code) {
    if (visited.has(code)) return
    visited.add(code)

    const prereqs = prereqMap[code] || []
    for (const prereq of prereqs) {
      if (courseSet.has(prereq)) {
        visit(prereq)
      }
    }

    const course = courses.find(c => c.code === code)
    if (course) result.push(course)
  }

  for (const course of courses) {
    visit(course.code)
  }

  return result
}

// ─── STEP 6: PACK INTO SEMESTERS ────────────────────────────────────────────
function packSemesters(orderedCourses, student, completedCodes, prereqMap) {
  const MAX_CREDITS = 17
  const MIN_CREDITS = 12

  const semesters = generateSemesters(student.target_graduation)
  const placed = new Map()
  const semesterPlans = semesters.map(s => ({ semester: s, courses: [], credits: 0 }))

  for (const course of orderedCourses) {
    const prereqs = prereqMap[course.code] || []
    let earliestSemester = 0

    for (const prereq of prereqs) {
      if (completedCodes.has(prereq)) continue
      const prereqSemIndex = placed.get(prereq)
      if (prereqSemIndex !== undefined) {
        earliestSemester = Math.max(earliestSemester, prereqSemIndex + 1)
      }
    }

    for (let i = earliestSemester; i < semesterPlans.length; i++) {
      if (semesterPlans[i].credits + parseFloat(course.credits) <= MAX_CREDITS) {
        semesterPlans[i].courses.push(course)
        semesterPlans[i].credits += parseFloat(course.credits)
        placed.set(course.code, i)
        break
      }
    }
  }

  return semesterPlans.filter(s => s.courses.length > 0)
}

function generateSemesters(targetGraduation) {
  const semesters = []
  const now = new Date()
  let year = now.getFullYear()
  let season = now.getMonth() < 6 ? 'Fall' : 'Spring'

  for (let i = 0; i < 10; i++) {
    const label = `${season} ${year}`
    semesters.push(label)
    if (label === targetGraduation) break

    if (season === 'Fall') {
      season = 'Spring'
      year += 1
    } else {
      season = 'Fall'
    }
  }

  return semesters
}

// ─── STEP 7: BUILD SUMMARY ──────────────────────────────────────────────────
function buildSummary(requirements, completedCodes, selectedCourses) {
  const selectedCodes = new Set(selectedCourses.map(c => c.code))
  const summary = []

  for (const group of requirements.groups) {
    const optionCodes = group.requirement_courses.map(rc => rc.course_code)
    const completedInGroup = optionCodes.filter(code => completedCodes.has(code))
    const plannedInGroup = optionCodes.filter(code => selectedCodes.has(code))

    let status = 'unsatisfied'
    if (group.rule_type === 'ALL') {
      const allRequired = group.requirement_courses
        .filter(rc => rc.is_required)
        .map(rc => rc.course_code)
      const allDone = allRequired.every(code =>
        completedCodes.has(code) || selectedCodes.has(code)
      )
      status = allDone ? (completedInGroup.length === allRequired.length ? 'complete' : 'planned') : 'unsatisfied'
    }
    if (group.rule_type === 'ONE_OF') {
      if (completedInGroup.length > 0) status = 'complete'
      else if (plannedInGroup.length > 0) status = 'planned'
    }
    if (group.rule_type === 'MIN_CREDITS') {
      status = plannedInGroup.length > 0 || completedInGroup.length > 0 ? 'planned' : 'unsatisfied'
    }

    summary.push({
      name: group.name,
      rule_type: group.rule_type,
      status,
      completed: completedInGroup,
      planned: plannedInGroup
    })
  }

  return summary
}