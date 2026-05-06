import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import axios from 'axios'

export default function Plan() {
  const { studentId } = useParams()
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeTab, setActiveTab] = useState('plan')

  useEffect(() => {
    axios.get(`/api/plan/${studentId}`)
      .then(res => {
        setData(res.data)
        setLoading(false)
      })
      .catch(err => {
        setError(err.response?.data?.error || 'Failed to load plan')
        setLoading(false)
      })
  }, [studentId])

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <div className="text-4xl mb-4">⏳</div>
        <p className="text-gray-600 font-medium">Generating your degree plan...</p>
        <p className="text-gray-400 text-sm mt-1">This may take a few seconds</p>
      </div>
    </div>
  )

  if (error) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <p className="text-red-600 font-medium">{error}</p>
        <button
          onClick={() => {
            localStorage.removeItem('studentId')
            navigate('/onboarding')
          }}
          className="mt-4 text-sm text-gray-500 underline"
        >
          Start over
        </button>
      </div>
    </div>
  )

  const { student, plan, targetGraduation, summary } = data

  const completedCredits = student.student_courses
    ?.filter(c => ['completed', 'ap', 'transfer_approved'].includes(c.status))
    .reduce((sum, c) => sum + parseFloat(c.credits || 0), 0) || 0

  const plannedCredits = plan
    .flatMap(s => s.courses)
    .filter(c => !c.is_elective && c.code !== 'COOP3945')
    .reduce((sum, c) => sum + parseFloat(c.credits || 0), 0)

  const electiveCredits = plan
    .flatMap(s => s.courses)
    .filter(c => c.is_elective)
    .reduce((sum, c) => sum + parseFloat(c.credits || 0), 0)

  const totalCredits = completedCredits + plannedCredits + electiveCredits

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-red-700 text-white py-5 px-8 flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold">NU Degree Planner</h1>
          <p className="text-red-200 text-sm">{student.name} · {student.major_code} {student.concentration}</p>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <div className="text-sm text-red-200">Estimated Graduation</div>
            <div className="font-bold">{targetGraduation}</div>
          </div>
          <button
            onClick={() => {
              localStorage.removeItem('studentId')
              navigate('/onboarding')
            }}
            className="text-red-200 text-sm hover:text-white transition-colors border border-red-400 px-3 py-1 rounded-lg"
          >
            Start Over
          </button>
        </div>
      </div>

      <div className="bg-white border-b px-8 py-4 flex gap-8">
        <div>
          <div className="text-2xl font-bold text-gray-800">{Math.round(totalCredits)}</div>
          <div className="text-xs text-gray-500">Total Credits</div>
        </div>
        <div>
          <div className="text-2xl font-bold text-green-600">{Math.round(completedCredits)}</div>
          <div className="text-xs text-gray-500">Completed</div>
        </div>
        <div>
          <div className="text-2xl font-bold text-blue-600">{Math.round(plannedCredits)}</div>
          <div className="text-xs text-gray-500">Planned</div>
        </div>
        <div>
          <div className="text-2xl font-bold text-purple-500">{Math.round(electiveCredits)}</div>
          <div className="text-xs text-gray-500">Electives</div>
        </div>
        <div>
          <div className="text-2xl font-bold text-gray-400">{Math.max(0, Math.round(134 - totalCredits))}</div>
          <div className="text-xs text-gray-500">Remaining</div>
        </div>
      </div>

      <div className="bg-white border-b px-8 flex gap-6">
        {['plan', 'requirements'].map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`py-3 text-sm font-medium border-b-2 capitalize transition-colors ${
              activeTab === tab
                ? 'border-red-600 text-red-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab === 'plan' ? 'Degree Plan' : 'Requirements'}
          </button>
        ))}
      </div>

      <div className="max-w-5xl mx-auto py-8 px-6">
        {activeTab === 'plan' && (
          <div className="space-y-6">
            {plan.map((semester, i) => (
              <SemesterCard key={i} semester={semester} />
            ))}
          </div>
        )}

        {activeTab === 'requirements' && (
          <div className="space-y-3">
            {summary.map((req, i) => (
              <RequirementRow key={i} req={req} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function SemesterCard({ semester }) {
  const isCoop = semester.type === 'coop'
  const isSummer = semester.type === 'summer'

  return (
    <div className={`rounded-xl border overflow-hidden ${
      isCoop ? 'border-yellow-200 bg-yellow-50' : 'border-gray-200 bg-white'
    }`}>
      <div className={`px-5 py-3 flex justify-between items-center ${
        isCoop ? 'bg-yellow-100' : isSummer ? 'bg-blue-50' : 'bg-gray-50'
      }`}>
        <div className="font-semibold text-gray-800">{semester.semester}</div>
        <div className="text-sm text-gray-500">
          {isCoop ? 'Co-op' : `${semester.credits} credits`}
        </div>
      </div>

      {isCoop ? (
        <div className="px-5 py-6 text-center">
          <div className="text-3xl mb-2">💼</div>
          <div className="font-medium text-yellow-700">Co-op Work Experience</div>
          <div className="text-sm text-yellow-600 mt-1">Full-time industry work experience</div>
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {semester.courses.map((course, i) => (
            <CourseRow key={i} course={course} />
          ))}
        </div>
      )}
    </div>
  )
}

function CourseRow({ course }) {
  const isCoop = course.code === 'COOP3945'
  const isElective = course.is_elective
  const courseType = course.course_type
  const isLab = courseType === 'lab'
  const isSeminar = courseType === 'seminar'
  const isRecitation = courseType === 'recitation'
  const isSupplementary = isLab || isSeminar || isRecitation

  if (isCoop) return null

  const typeLabel = isLab ? 'Lab' : isSeminar ? 'Seminar' : isRecitation ? 'Recitation' : null
  const typeBg = isLab
    ? 'bg-gray-200 text-gray-600'
    : isSeminar
    ? 'bg-blue-100 text-blue-700'
    : isRecitation
    ? 'bg-orange-100 text-orange-700'
    : ''

  return (
    <div className={`px-5 py-3 flex justify-between items-center ${
      isElective ? 'bg-purple-50' : isSupplementary ? 'bg-gray-50' : ''
    }`}>
      <div className="flex items-center gap-3">
        {typeLabel && (
          <span className={`text-xs px-2 py-0.5 rounded ${typeBg}`}>{typeLabel}</span>
        )}
        {isElective && (
          <span className="text-xs bg-purple-200 text-purple-700 px-2 py-0.5 rounded">Elective</span>
        )}
        <div>
          {!isElective && (
            <span className="font-mono text-sm font-medium text-red-700">{course.code} </span>
          )}
          <span className="text-gray-700 text-sm">{course.title}</span>
        </div>
      </div>
      <div className="text-sm text-gray-400">{course.credits} cr</div>
    </div>
  )
}

function RequirementRow({ req }) {
  const statusColor = {
    complete: 'text-green-600',
    planned: 'text-blue-600',
    unsatisfied: 'text-red-500'
  }
  const statusIcon = {
    complete: '✓',
    planned: '◷',
    unsatisfied: '✗'
  }
  const statusBg = {
    complete: 'bg-green-50 border-green-200',
    planned: 'bg-blue-50 border-blue-200',
    unsatisfied: 'bg-red-50 border-red-200'
  }

  return (
    <div className={`px-5 py-4 rounded-lg border ${statusBg[req.status]}`}>
      <div className="flex justify-between items-start">
        <div>
          <span className={`font-medium ${statusColor[req.status]}`}>
            {statusIcon[req.status]} {req.name}
          </span>
          {req.name === 'General Electives' && req.credits_needed > 0 && (
            <div className="text-xs text-red-500 mt-1">
              {req.credits_needed} more credits needed — choose any courses with your advisor
            </div>
          )}
          {req.completed?.length > 0 && (
            <div className="text-xs text-green-600 mt-1">
              Completed: {req.completed.join(', ')}
            </div>
          )}
          {req.planned?.length > 0 && (
            <div className="text-xs text-blue-600 mt-1">
              Planned: {req.planned.join(', ')}
            </div>
          )}
        </div>
        <span className={`text-xs font-medium capitalize ${statusColor[req.status]}`}>
          {req.status}
        </span>
      </div>
    </div>
  )
}