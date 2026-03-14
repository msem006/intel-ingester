import logging, os, sys
logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(name)s %(message)s')
if __name__ == '__main__':
    for var in ['TOPIC_ID', 'SOURCE_ID']:
        if not os.environ.get(var): logging.error(f"Required env var {var} not set"); sys.exit(1)
    from worker import PodcastWorker
    PodcastWorker().run()
