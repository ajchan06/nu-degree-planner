import express from 'express'
import supabase from '../supabase.js'

const router = express.Router()

router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('majors')
      .select('*')
      .order('name')

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
      .from('majors')
      .select(`
        *,
        requirement_groups (
          id,
          name,
          rule_type,
          min_credits,
          min_courses,
          is_nupath
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