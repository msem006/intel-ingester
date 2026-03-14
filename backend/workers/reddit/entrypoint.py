import logging, os, sys
logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(name)s %(message)s')
logger = logging.getLogger(__name__)

if __name__ == '__main__':
    for var in ['TOPIC_ID', 'SOURCE_ID']:
        if not os.environ.get(var):
            logger.error(f"Required environment variable {var} is not set")
            sys.exit(1)
    from worker import RedditWorker
    RedditWorker().run()
