export interface Health {
  status: string
  actuals: number
  forecasts: number
}

export async function fetchHealth(signal?: AbortSignal): Promise<Health> {
  const resp = await fetch('/api/health', { signal })
  if (!resp.ok) {
    throw new Error(`API responded ${resp.status}`)
  }
  return (await resp.json()) as Health
}
