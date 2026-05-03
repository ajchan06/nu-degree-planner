import express from 'express'
import supabase from '../supabase.js'

const router = express.Router()

router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('courses')
      .select('*')
      .order('code')

    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/major/:majorCode', async (req, res) => {
  try {
    const { majorCode } = req.params

    const { data, error } = await supabase
      .from('requirement_courses')
      .select(`
        is_required,
        requirement_groups!inner (
          name,
          rule_type,
          major_code
        ),
        courses!inner (
          code,
          title,
          credits,
          is_lab
        )
      `)
      .eq('requirement_groups.major_code', majorCode)

    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/:code', async (req, res) => {
  try {
    const { code } = req.params

    const { data, error } = await supabase
      .from('courses')
      .select(`
        *,
        prerequisites!prerequisites_course_code_fkey (
          requires_code
        )
      `)
      .eq('code', code)
      .single()

    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router