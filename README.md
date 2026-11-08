# Nasa-Hackathon-Planet-X-and-SPHEREx

https://www.spaceappschallenge.org/2026/challenges/planet-x-and-spherex/?tab=details

Planned Features not shown in mockup
  - option to select images that used different infrared bands to capture it
  - include coordinates in the url so it can be embedded in other websites or projects
  - add or subtract images to help identify changes

Features shown in mockup
  - Field of view slider
  - coordinate input
  - timeline
  - zoomed in view
  - ruler for measuring distance between objects

Mockup Design with Figma
<img width="1512" height="982" alt="image" src="https://github.com/user-attachments/assets/45957cf4-4cda-43e7-8f2e-84d67ffa9eb8" />

Tasks:
 
  - Develop Prototype GUI using React + Typescript + Vite and style with Tailwind CSS
    - Right Ascension, Declination, and FOV input panel
    - Viewport
      - Rendered image
      - Gyroscope showing viewing angle based on Right Ascension and Declination
      - Zoomed view box
      - Letterboxing (Black bars seen in movies)
    - Playback control to view/save rendered images of astronomical data visible in the viewport over time
  - Develop FastAPI backend to fetch and process NASA astronomical data for rendering
    - Analyze astronomical data and define API response format
    - Optimize data fetching preferably on separate thread to keep UI running smooth
    - Use FOV to optimize size of data fetches (i.e., small FOV doesn't need to display as much data, so don't overfetch)
  - Develop Rendering API using WebGL2 for various celestial objects
    - Will define subtasks based on released resources when event opens...

Tech Stack:
 
React + Typescript + Vite \
Tailwind CSS \
WebGL2 \
FastAPI + Python 3.15 




