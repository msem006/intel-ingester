"""ECS Fargate entrypoint for the RSS worker."""
import logging
import os
import sys

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(name)s %(message)s')
logger = logging.getLogger(__name__)

if __name__ == '__main__':
    # Validate required env vars before importing worker (better error messages)
    for var in ['TOPIC_ID', 'SOURCE_ID']:
        if not os.environ.get(var):
            logger.error(f"Required environment variable {var} is not set")
            sys.exit(1)

    from worker import RssWorker
    RssWorker().run()
