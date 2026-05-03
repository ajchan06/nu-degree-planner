import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'

const MAJORS = [
  { code: 'BSCS', name: 'Computer Science' },
  { code: 'BSDS', name: 'Data Science' },
  { code: 'BSCY', name: 'Cybersecurity' },
  { code: 'BACS', name: 'Computer Science and Cognitive Psychology' },
]

const CONCENTRATIONS = {
  BSCS: ['Artificial Intelligence', 'Foundations', 'Human-Centered Computing', 'Software', 'Systems'],
  BSDS: ['Artificial Intelligence', 'Business', 'Dialogue Systems', 'Life Sciences', 'Security'],
  BSCY: [''],
  BACS: [''],
}

const AP_EXAMS = [
  { exam: 'AP Calculus AB', courses: [{ code: 'MATH1341', credits: 4 }] },
  { exam: 'AP Calculus BC', courses: [{ code: 'MATH1341', credits: 4 }, { code: 'MATH1342', credits: 4 }] },
  { exam: 'AP Statistics', courses: [{ code: 'MATH2280', credits: 4 }] },
  { exam: 'AP Computer Science A', courses: [{ code: 'CS2000', credits: 4 }] },
  { exam: 'AP Computer Science Principles', courses: [{ code: 'CS1800', credits: 4 }] },
  { exam: 'AP Biology', courses: [{ code: 'BIOL1111', credits: 4 }, { code: 'BIOL1113', credits: 4 }] },
  { exam: 'AP Chemistry', courses: [{ code: 'CHEM1161', credits: 4 }] },
  { exam: 'AP Physics 1', courses: [{ code: 'PHYS1145', credits: 4 }] },
  { exam: 'AP Physics 2', courses: [{ code: 'PHYS1147', credits: 4 }] },
  { exam: 'AP English Language', courses: [{ code: 'ENGW1111', credits: 4 }] },
  { exam: 'AP English Literature', courses: [{ code: 'ENGW1111', credits: 4 }] },
]

const CURRENT_YEAR = new Date().getFullYear()
const START_YEARS = [CURRENT_YEAR - 3, CURRENT_YEAR - 2, CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1]

export default function Onboarding() {
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const [form, setForm] = useState({
    name: '',
    email: '',
    major_code: 'BSCS',
    concentration: 'Systems',
    start_year: CURRENT_YEAR,
    num_coops: 2,
    ap_credits: [],
    completed_courses: []
  })

  const [courseInput, setCourseInput] = useState('')
  const [courseCredits, setCourseCredits] = useState(4)

  function updateForm(field, value) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  function toggleAP(exam) {
    setForm(prev => {
      const exists = prev.ap_credits.find(a => a.exam === exam.exam)
      if (exists) {
        return { ...prev, ap_credits: prev.ap_credits.filter(a => a.exam !== exam.exam) }
      } else {
        let updated = [...prev.ap_credits]
        if (exam.exam === 'AP Calculus BC') {
          updated = updated.filter(a => a.exam !== 'AP Calculus AB')
        }
        if (exam.exam === 'AP Calculus AB') {
          updated = updated.filter(a => a.exam !== 'AP Calculus BC')
        }
        if (exam.exam === 'AP English Language') {
          updated = updated.filter(a => a.exam !== 'AP English Literature')
        }
        if (exam.exam === 'AP English Literature') {
          updated = updated.filter(a => a.exam !== 'AP English Language')
        }
        return { ...prev, ap_credits: [...updated, exam] }
      }
    })
  }

  function addCourse() {
    const code = courseInput.trim().toUpperCase()
    if (!code) return
    if (form.completed_courses.find(c => c.code === code)) return
    setForm(prev => ({
      ...prev,
      completed_courses: [...prev.completed_courses, { code, credits: courseCredits, source: 'taken' }]
    }))
    setCourseInput('')
    setCourseCredits(4)
  }

  function removeCourse(code) {
    setForm(prev => ({
      ...prev,
      completed_courses: prev.completed_courses.filter(c => c.code !== code)
    }))
  }

  async function handleSubmit() {
    setLoading(true)
    setError(null)
    try {
      const studentRes = await axios.post('/api/students', {
        name: form.name,
        email: form.email,
        major_code: form.major_code,
        concentration: form.concentration,
        catalog_year: form.start_year,
        start_year: form.start_year,
        num_coops: form.num_coops,
        target_graduation: null
      })
      const studentId = studentRes.data.id

      for (const ap of form.ap_credits) {
        for (const course of ap.courses) {
          await axios.post(`/api/students/${studentId}/courses`, {
            course_code: course.code,
            status: 'ap',
            source: 'ap',
            credits: course.credits
          })
        }
      }

      for (const course of form.completed_courses) {
        await axios.post(`/api/students/${studentId}/courses`, {
          course_code: course.code,
          status: 'completed',
          source: course.source || 'taken',
          credits: course.credits
        })
      }

      navigate(`/plan/${studentId}`)
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-red-700 text-white py-6 px-8">
        <h1 className="text-2xl font-bold">NU Degree Planner</h1>
        <p className="text-red-200 text-sm mt-1">Generate your personalized degree plan</p>
      </div>

      <div className="flex border-b bg-white">
        {['Your Info', 'Major', 'AP Credits', 'Completed Courses', 'Review'].map((label, i) => (
          <button
            key={i}
            onClick={() => setStep(i + 1)}
            className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${
              step === i + 1
                ? 'border-red-600 text-red-600'
                : step > i + 1
                ? 'border-green-500 text-green-600'
                : 'border-transparent text-gray-400'
            }`}
          >
            {step > i + 1 ? '✓ ' : ''}{label}
          </button>
        ))}
      </div>

      <div className="max-w-2xl mx-auto py-10 px-6">

        {step === 1 && (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-gray-800">Tell us about yourself</h2>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
              <input
                type="text"
                value={form.name}
                onChange={e => updateForm('name', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-red-500"
                placeholder="Jane Smith"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Northeastern Email</label>
              <input
                type="email"
                value={form.email}
                onChange={e => updateForm('email', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-red-500"
                placeholder="smith.j@northeastern.edu"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Year you started at Northeastern</label>
              <select
                value={form.start_year}
                onChange={e => updateForm('start_year', parseInt(e.target.value))}
                className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                {START_YEARS.map(y => (
                  <option key={y} value={y}>Fall {y}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Number of co-ops</label>
              <div className="flex gap-4">
                {[1, 2, 3].map(n => (
                  <button
                    key={n}
                    onClick={() => updateForm('num_coops', n)}
                    className={`flex-1 py-3 rounded-lg border-2 font-medium transition-colors ${
                      form.num_coops === n
                        ? 'border-red-600 bg-red-50 text-red-700'
                        : 'border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    {n} Co-op{n > 1 ? 's' : ''}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-gray-800">Choose your major</h2>
            <div className="grid grid-cols-1 gap-3">
              {MAJORS.map(m => (
                <button
                  key={m.code}
                  onClick={() => {
                    updateForm('major_code', m.code)
                    updateForm('concentration', CONCENTRATIONS[m.code][0])
                  }}
                  className={`text-left px-5 py-4 rounded-lg border-2 transition-colors ${
                    form.major_code === m.code
                      ? 'border-red-600 bg-red-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="font-medium text-gray-800">{m.name}</div>
                  <div className="text-sm text-gray-500">{m.code}</div>
                </button>
              ))}
            </div>
            {CONCENTRATIONS[form.major_code]?.[0] && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Concentration</label>
                <div className="grid grid-cols-1 gap-2">
                  {CONCENTRATIONS[form.major_code].map(c => (
                    <button
                      key={c}
                      onClick={() => updateForm('concentration', c)}
                      className={`text-left px-4 py-3 rounded-lg border-2 transition-colors ${
                        form.concentration === c
                          ? 'border-red-600 bg-red-50 text-red-700'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-800">AP Credits</h2>
            <p className="text-gray-500 text-sm">Select any AP exams you scored 4 or 5 on.</p>
            <div className="space-y-2">
              {AP_EXAMS.map(ap => (
                <button
                  key={ap.exam}
                  onClick={() => toggleAP(ap)}
                  className={`w-full text-left px-4 py-3 rounded-lg border-2 transition-colors flex justify-between items-center ${
                    form.ap_credits.find(a => a.exam === ap.exam)
                      ? 'border-red-600 bg-red-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div>
                    <div className="font-medium text-gray-800">{ap.exam}</div>
                    <div className="text-sm text-gray-500">
                      {ap.courses.map(c => c.code).join(' + ')} · {ap.courses.reduce((s, c) => s + c.credits, 0)} credits
                    </div>
                  </div>
                  {form.ap_credits.find(a => a.exam === ap.exam) && (
                    <span className="text-red-600 font-bold">✓</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-800">Completed Courses</h2>
            <p className="text-gray-500 text-sm">Enter courses you've already taken at Northeastern or transferred in.</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={courseInput}
                onChange={e => setCourseInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addCourse()}
                className="flex-1 border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-red-500"
                placeholder="e.g. CS1800"
              />
              <select
                value={courseCredits}
                onChange={e => setCourseCredits(parseInt(e.target.value))}
                className="border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                {[1, 2, 3, 4, 5].map(n => (
                  <option key={n} value={n}>{n} cr</option>
                ))}
              </select>
              <button
                onClick={addCourse}
                className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors"
              >
                Add
              </button>
            </div>
            <div className="space-y-2">
              {form.completed_courses.map(c => (
                <div key={c.code} className="flex justify-between items-center px-4 py-3 bg-white border border-gray-200 rounded-lg">
                  <div>
                    <span className="font-medium text-gray-800">{c.code}</span>
                    <span className="text-gray-500 text-sm ml-2">· {c.credits} credits</span>
                  </div>
                  <button
                    onClick={() => removeCourse(c.code)}
                    className="text-red-500 hover:text-red-700 text-sm"
                  >
                    Remove
                  </button>
                </div>
              ))}
              {form.completed_courses.length === 0 && (
                <p className="text-gray-400 text-sm text-center py-4">No courses added yet</p>
              )}
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-gray-800">Review your information</h2>
            <div className="bg-white border border-gray-200 rounded-lg divide-y">
              <div className="px-5 py-4">
                <div className="text-sm text-gray-500">Name</div>
                <div className="font-medium text-gray-800">{form.name || '—'}</div>
              </div>
              <div className="px-5 py-4">
                <div className="text-sm text-gray-500">Email</div>
                <div className="font-medium text-gray-800">{form.email || '—'}</div>
              </div>
              <div className="px-5 py-4">
                <div className="text-sm text-gray-500">Start Year</div>
                <div className="font-medium text-gray-800">Fall {form.start_year}</div>
              </div>
              <div className="px-5 py-4">
                <div className="text-sm text-gray-500">Major</div>
                <div className="font-medium text-gray-800">{form.major_code} — {form.concentration}</div>
              </div>
              <div className="px-5 py-4">
                <div className="text-sm text-gray-500">Co-ops</div>
                <div className="font-medium text-gray-800">{form.num_coops}</div>
              </div>
              <div className="px-5 py-4">
                <div className="text-sm text-gray-500">AP Credits</div>
                <div className="font-medium text-gray-800">
                  {form.ap_credits.length > 0 ? form.ap_credits.map(a => a.exam).join(', ') : 'None'}
                </div>
              </div>
              <div className="px-5 py-4">
                <div className="text-sm text-gray-500">Completed Courses</div>
                <div className="font-medium text-gray-800">
                  {form.completed_courses.length > 0
                    ? form.completed_courses.map(c => c.code).join(', ')
                    : 'None'}
                </div>
              </div>
            </div>
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}
            <button
              onClick={handleSubmit}
              disabled={loading || !form.name || !form.email}
              className="w-full bg-red-600 text-white py-3 rounded-lg font-semibold text-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Generating your plan...' : 'Generate My Degree Plan →'}
            </button>
          </div>
        )}

        <div className="flex justify-between mt-10">
          {step > 1 ? (
            <button
              onClick={() => setStep(s => s - 1)}
              className="px-6 py-2 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors"
            >
              ← Back
            </button>
          ) : <div />}
          {step < 5 && (
            <button
              onClick={() => setStep(s => s + 1)}
              className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
            >
              Next →
            </button>
          )}
        </div>

      </div>
    </div>
  )
}