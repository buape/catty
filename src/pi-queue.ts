export const createPiQueue = () => {
	const piJobs: Array<{
		run: () => Promise<void>
		lowPriority: boolean
		resolve: () => void
		reject: (error: unknown) => void
	}> = []
	let piRunning = false
	const runPiJobs = async () => {
		if (piRunning) return
		piRunning = true
		try {
			while (piJobs.length > 0) {
				const normalIndex = piJobs.findIndex((job) => !job.lowPriority)
				const [job] = piJobs.splice(
					normalIndex === -1 ? 0 : normalIndex,
					1
				)
				if (!job) continue
				try {
					await job.run()
					job.resolve()
				} catch (error) {
					job.reject(error)
				}
			}
		} finally {
			piRunning = false
		}
	}
	return (run: () => Promise<void>, options?: { lowPriority?: boolean }) =>
		new Promise<void>((resolve, reject) => {
			const lowPriority = options?.lowPriority === true
			piJobs.push({
				run,
				lowPriority,
				resolve,
				reject
			})
			if (lowPriority) setTimeout(() => void runPiJobs(), 1500)
			else void runPiJobs()
		})
}
