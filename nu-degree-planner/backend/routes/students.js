import express from 'express'
import supabase from '../supabase.js'

const router = express.Router()

// POST /students — create a new student
router.post('/', async (req, res) => {
  try {
    const {
      email,
      name,
      major_code,
      concentration,
      catalog_year,
      target_graduation
    } = req.body

    if (!email || !name || !major_code || !catalog_year) {
      return res.status(400).json({
        error: 'email, name, major_code and catalog_year are required'
      })
    }

    const { data, error } = await supabase
      .from('students')
      .insert([{
        email,
        name,
        major_code,
        concentration,
        catalog_year,
        target_graduation
      }])
      .select()
      .single()

    if (error) throw error
    res.status(201).json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /students/:id — get a student with their courses
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params

    const { data, error } = await supabase
      .from('students')
      .select(`
        *,
        student_courses (
          id,
          course_code,
          status,
          grade,
          credits,
          semester,
          source,
          transfer_note
        )
      `)
      .eq('id', id)
      .single()

    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /students/:id/courses — add a course to a student
router.post('/:id/courses', async (req, res) => {
  try {
    const { id } = req.params
    const {
      course_code,
      status,
      grade,
      credits,
      semester,
      source,
      transfer_note
    } = req.body

    if (!course_code || !status || !source) {
      return res.status(400).json({
        error: 'course_code, status and source are required'
      })
    }

    const { data, error } = await supabase
      .from('student_courses')
      .insert([{
        student_id: parseInt(id),
        course_code,
        status,
        grade,
        credits,
        semester,
        source,
        transfer_note
      }])
      .select()
      .single()

    if (error) throw error
    res.status(201).json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PATCH /students/:id/courses/:courseCode — update a course status
router.patch('/:id/courses/:courseCode', async (req, res) => {
  try {
    const { id, courseCode } = req.params
    const updates = req.body

    const { data, error } = await supabase
      .from('student_courses')
      .update(updates)
      .eq('student_id', id)
      .eq('course_code', courseCode)
      .select()
      .single()

    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /students/:id/courses/:courseCode — remove a course
router.delete('/:id/courses/:courseCode', async (req, res) => {
  try {
    const { id, courseCode } = req.params

    const { error } = await supabase
      .from('student_courses')
      .delete()
      .eq('student_id', id)
      .eq('course_code', courseCode)

    if (error) throw error
    res.json({ message: 'Course removed successfully' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router