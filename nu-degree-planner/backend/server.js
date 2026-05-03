import express from 'express'
import dotenv from 'dotenv'
import majorsRouter from './routes/majors.js'
import coursesRouter from './routes/courses.js'
import studentsRouter from './routes/students.js'
import { generatePlan } from './generator/planner.js'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3000

app.use(express.json())

app.get('/', (req, res) => {
  res.json({ message: 'NU Degree Planner API is running' })
})

app.use('/majors', majorsRouter)
app.use('/courses', coursesRouter)
app.use('/students', studentsRouter)

app.get('/plan/:studentId', async (req, res) => {
  try {
    const plan = await generatePlan(parseInt(req.params.studentId))
    res.json(plan)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})

server.on('error', (err) => {
  console.error('Server error:', err)
})

export default app