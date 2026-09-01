import { fileURLToPath } from 'node:url'

export const HARNESS_WORKSPACE_PATH = 'D:\\deepseek\\harness-pet-workspace'
export const HARNESS_PROFILE_PATCH_PATH = fileURLToPath(
  new URL('../../config/harness-pet.cordis.yml', import.meta.url),
)
